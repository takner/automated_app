import { HttpError, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { features } from '@/lib/env';
import { rateLimit } from '@/lib/rate-limit';
import { claimOne, processNotification } from '@/lib/notifications/sender';

/** Sends a test reminder right away through the same queue path the worker uses. */
export const POST = route(async (_req, { user }) => {
  if (!features().push) throw new HttpError(503, 'اعلان‌ها روی سرور پیکربندی نشده‌اند', 'push_not_configured');
  if (!rateLimit(`pushtest:${user.id}`, 10, 10 * 60_000).ok) throw new HttpError(429, 'کمی بعد دوباره امتحان کنید', 'rate_limited');
  const now = new Date();
  const n = await prisma.notification.create({
    data: {
      userId: user.id, sourceType: 'test', dedupeKey: `test:${user.id}:${now.getTime()}`, fireAt: now, nextAttemptAt: now,
      title: 'اعلان آزمایشی هم‌روز', body: 'اگر این را می‌بینید، اعلان‌ها روی این دستگاه کار می‌کنند.', url: '/settings#notifications',
    },
  });
  const claimed = await claimOne(n.id);
  if (!claimed) return { status: 'queued' };
  const out = await processNotification(claimed, { ignoreQuiet: true });
  return out;
});
