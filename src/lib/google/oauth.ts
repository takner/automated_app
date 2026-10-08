// Google OAuth 2.0 (authorization code + PKCE), used for two separate purposes:
// - login: `openid email` only, accepted solely for OWNER_EMAIL
// - calendar: minimal Calendar scopes, offline access (refresh token)
import { createHash } from 'node:crypto';
import { prisma } from '../db';
import { env } from '../env';
import { randomToken, sha256 } from '../crypto';
import { HttpError } from '../errors';

export const CALENDAR_SCOPES = [
  'openid',
  'email',
  // list calendars (to let the user choose which ones block time)
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
  // read events
  'https://www.googleapis.com/auth/calendar.events.readonly',
  // create a dedicated calendar and manage only the calendars this app created
  'https://www.googleapis.com/auth/calendar.app.created',
];

export type OAuthPurpose = 'login' | 'calendar';
export type Fetch = typeof fetch;

export const redirectUri = () => `${env().APP_URL}/api/google/callback`;

export async function buildAuthUrl(purpose: OAuthPurpose, userId: string | null): Promise<string> {
  const e = env();
  if (!e.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google OAuth پیکربندی نشده است', 'google_not_configured');
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  await prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await prisma.oAuthState.create({
    data: { id: sha256(state), purpose, userId, codeVerifier: verifier, expiresAt: new Date(Date.now() + 10 * 60_000) },
  });
  const p = new URLSearchParams({
    client_id: e.GOOGLE_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: purpose === 'login' ? 'openid email' : CALENDAR_SCOPES.join(' '),
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    ...(purpose === 'calendar' ? { access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false' } : { prompt: 'select_account' }),
    ...(e.OWNER_EMAIL ? { login_hint: e.OWNER_EMAIL } : {}),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

/** Single-use: the state row is deleted whether or not it is valid. */
export async function consumeState(state: string) {
  const id = sha256(state);
  const row = await prisma.oAuthState.findUnique({ where: { id } });
  if (row) await prisma.oAuthState.delete({ where: { id } }).catch(() => {});
  if (!row || row.expiresAt < new Date()) throw new HttpError(400, 'درخواست ورود منقضی یا نامعتبر است', 'bad_state');
  return row;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  id_token?: string;
  token_type: string;
}

export async function exchangeCode(code: string, verifier: string, http: Fetch = fetch): Promise<TokenResponse> {
  const e = env();
  const res = await http('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: e.GOOGLE_CLIENT_ID!,
      client_secret: e.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  });
  if (!res.ok) throw new HttpError(502, 'تبادل کد با Google ناموفق بود', 'google_token_error');
  return (await res.json()) as TokenResponse;
}

export class RefreshRevokedError extends Error {}

export async function refreshAccessToken(refreshToken: string, http: Fetch = fetch): Promise<TokenResponse> {
  const e = env();
  const res = await http('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: e.GOOGLE_CLIENT_ID!,
      client_secret: e.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (res.status === 400 || res.status === 401) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === 'invalid_grant' || res.status === 401) throw new RefreshRevokedError(body.error ?? 'unauthorized');
  }
  if (!res.ok) throw new Error(`token refresh failed: ${res.status}`);
  return (await res.json()) as TokenResponse;
}

export async function revokeToken(token: string, http: Fetch = fetch) {
  await http(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' }).catch(() => {});
}

/**
 * The id_token comes straight from Google's token endpoint over TLS (not via the browser), so
 * per OIDC Core §3.1.3.7 its claims can be read without re-verifying the signature; we still
 * check issuer, audience and expiry.
 */
export function readIdToken(idToken: string): { email: string; emailVerified: boolean; sub: string } {
  const [, payload] = idToken.split('.');
  const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
  const e = env();
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') throw new HttpError(400, 'id_token نامعتبر');
  if (c.aud !== e.GOOGLE_CLIENT_ID) throw new HttpError(400, 'id_token نامعتبر');
  if (typeof c.exp !== 'number' || c.exp * 1000 < Date.now() - 60_000) throw new HttpError(400, 'id_token منقضی');
  return { email: String(c.email ?? '').toLowerCase(), emailVerified: c.email_verified === true, sub: String(c.sub) };
}
