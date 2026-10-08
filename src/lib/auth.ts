import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from './db';
import { randomToken, sha256 } from './crypto';
import { isProd } from './env';

export const SESSION_COOKIE = isProdCookieName();
const SESSION_DAYS = 30;
const REFRESH_AFTER_MS = 60 * 60 * 1000;

function isProdCookieName() {
  // __Host- prefix pins the cookie to this exact origin over HTTPS
  return process.env.NODE_ENV === 'production' ? '__Host-hz_session' : 'hz_session';
}

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
  sessionId: string;
}

export async function createSession(userId: string): Promise<void> {
  const token = randomToken(32);
  const h = await headers();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await prisma.session.create({
    data: { id: sha256(token), userId, expiresAt, userAgent: h.get('user-agent')?.slice(0, 200) ?? null },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const id = sha256(token);
  const s = await prisma.session.findUnique({ where: { id }, include: { user: true } });
  if (!s) return null;
  if (s.expiresAt < new Date()) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  if (Date.now() - s.lastSeenAt.getTime() > REFRESH_AFTER_MS) {
    await prisma.session
      .update({ where: { id }, data: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_DAYS * 86400_000) } })
      .catch(() => {});
  }
  return { id: s.user.id, email: s.user.email, name: s.user.name, sessionId: id };
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { id: sha256(token) } });
  jar.delete(SESSION_COOKIE);
}

/** For server components/pages: redirect to /login when signed out. */
export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}
