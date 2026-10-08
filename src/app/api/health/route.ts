// Public health endpoint: no user data, no secrets.
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export async function GET() {
  const now = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const hb = await prisma.workerHeartbeat.findUnique({ where: { name: 'worker' } });
    const lagging = await prisma.notification.count({ where: { status: 'pending', nextAttemptAt: { lt: new Date(now - 5 * 60_000) } } });
    const workerAge = hb ? Math.round((now - hb.beatAt.getTime()) / 1000) : null;
    const workerOk = workerAge != null && workerAge < 120;
    return Response.json(
      { ok: true, release: env().APP_RELEASE, db: 'ok', worker: { ok: workerOk, lastBeatSecondsAgo: workerAge }, laggingReminders: lagging },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch {
    return Response.json({ ok: false, release: env().APP_RELEASE, db: 'error' }, { status: 503 });
  }
}
