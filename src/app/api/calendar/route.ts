import { z } from 'zod';
import { NextResponse } from 'next/server';
import { HttpError, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { features } from '@/lib/env';
import { buildAuthUrl } from '@/lib/google/oauth';
import { disconnect, syncConnection } from '@/lib/google/calendar';
import { rateLimit } from '@/lib/rate-limit';

export const GET = route(async (req, { user }) => {
  if (req.nextUrl.searchParams.get('connect') === '1') {
    if (!features().google) throw new HttpError(503, 'Google Calendar روی سرور پیکربندی نشده است', 'google_not_configured');
    return NextResponse.redirect(await buildAuthUrl('calendar', user.id));
  }
  const conn = await prisma.calendarConnection.findUnique({ where: { userId: user.id }, include: { sources: { orderBy: [{ primary: 'desc' }, { summary: 'asc' }] } } });
  return {
    configured: features().google,
    connection: conn && {
      googleEmail: conn.googleEmail,
      status: conn.status,
      lastSyncAt: conn.lastSyncAt,
      lastSyncError: conn.lastSyncError,
      hasAppCalendar: !!conn.appCalendarId,
      sources: conn.sources.map((s) => ({ id: s.id, summary: s.summary, color: s.color, primary: s.primary, selected: s.selected, isAppCalendar: s.isAppCalendar })),
    },
  };
});

const selectBody = z.object({ selected: z.array(z.string()).max(100) });

/** Choose which calendars are read for busy time. */
export const PATCH = route(async (req, { user }) => {
  const { selected } = selectBody.parse(await readJson(req));
  const conn = await prisma.calendarConnection.findUnique({ where: { userId: user.id } });
  if (!conn) throw new HttpError(404, 'اتصالی وجود ندارد');
  await prisma.$transaction([
    prisma.calendarSource.updateMany({ where: { connectionId: conn.id }, data: { selected: false } }),
    prisma.calendarSource.updateMany({ where: { connectionId: conn.id, id: { in: selected } }, data: { selected: true } }),
  ]);
  return { ok: true };
});

/** Manual sync. */
export const POST = route(async (_req, { user }) => {
  if (!rateLimit(`calsync:${user.id}`, 10, 10 * 60_000).ok) throw new HttpError(429, 'کمی بعد دوباره امتحان کنید', 'rate_limited');
  const conn = await prisma.calendarConnection.findUnique({ where: { userId: user.id } });
  if (!conn) throw new HttpError(404, 'اتصالی وجود ندارد');
  try {
    return await syncConnection(conn);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    const fresh = await prisma.calendarConnection.findUnique({ where: { id: conn.id } });
    throw new HttpError(502, fresh?.lastSyncError ?? 'همگام‌سازی ناموفق بود');
  }
});

/** Disconnect: revoke at Google (best effort) and delete stored tokens and cached events. */
export const DELETE = route(async (_req, { user }) => {
  await disconnect(user.id);
  return { ok: true };
});
