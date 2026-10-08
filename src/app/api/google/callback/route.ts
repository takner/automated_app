// Single OAuth redirect URI for both purposes; the single-use `state` row says which flow it is.
import { NextResponse, type NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { createSession, getSessionUser } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { env } from '@/lib/env';
import { HttpError } from '@/lib/errors';
import { log } from '@/lib/log';
import { consumeState, exchangeCode, readIdToken } from '@/lib/google/oauth';
import { ensureAppCalendar, refreshCalendarList, syncConnection } from '@/lib/google/calendar';

function back(path: string, params: Record<string, string>) {
  const u = new URL(path, env().APP_URL);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const state = q.get('state');
  let purpose: string = 'login';
  try {
    if (!state) throw new HttpError(400, 'state ندارد', 'bad_state');
    const st = await consumeState(state);
    purpose = st.purpose;
    if (q.get('error')) throw new HttpError(400, 'دسترسی در Google تأیید نشد', 'denied');
    const code = q.get('code');
    if (!code) throw new HttpError(400, 'کد Google دریافت نشد', 'no_code');
    const tokens = await exchangeCode(code, st.codeVerifier);
    if (!tokens.id_token) throw new HttpError(400, 'پاسخ Google ناقص است');
    const id = readIdToken(tokens.id_token);

    if (st.purpose === 'login') {
      const owner = env().OWNER_EMAIL?.toLowerCase();
      if (!owner || !id.emailVerified || id.email !== owner) {
        log.warn('google login rejected (not allowlisted)');
        throw new HttpError(403, 'این حساب Google اجازهٔ ورود ندارد', 'not_allowed');
      }
      // explicit allowlist: the owner account may be created on first Google sign-in
      const user = await prisma.user.upsert({ where: { email: owner }, update: {}, create: { email: owner, settings: { create: {} } } });
      await createSession(user.id);
      return back('/', {});
    }

    // calendar connection: must still be the same signed-in user who started the flow
    const user = await getSessionUser();
    if (!user || user.id !== st.userId) throw new HttpError(403, 'نشست شما تغییر کرده است؛ دوباره امتحان کنید', 'session_mismatch');
    const granted = tokens.scope.split(' ');
    if (!granted.some((s) => s.endsWith('calendar.events.readonly'))) throw new HttpError(400, 'دسترسی خواندن تقویم داده نشد', 'scope_missing');
    const existing = await prisma.calendarConnection.findUnique({ where: { userId: user.id } });
    const data = {
      googleEmail: id.email,
      accessTokenEnc: encrypt(tokens.access_token),
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      scope: tokens.scope,
      status: 'active' as const,
      lastSyncError: null,
      ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}),
    };
    const conn = existing
      ? await prisma.calendarConnection.update({ where: { id: existing.id }, data })
      : await prisma.calendarConnection.create({ data: { userId: user.id, ...data } });
    try {
      if (granted.some((s) => s.endsWith('calendar.app.created'))) await ensureAppCalendar(conn);
      await refreshCalendarList(conn);
      await syncConnection(conn);
    } catch (err) {
      log.warn('initial calendar sync failed', { err });
    }
    return back('/settings', { calendar: 'connected' });
  } catch (err) {
    const msg = err instanceof HttpError ? err.message : 'اتصال به Google ناموفق بود';
    if (!(err instanceof HttpError)) log.error('google callback failed', { err });
    return back(purpose === 'calendar' ? '/settings' : '/login', { error: msg });
  }
}
