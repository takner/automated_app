import { route } from '@/lib/api';
import { prisma } from '@/lib/db';

/** Status page data: upcoming, recent and failed reminders + worker health. */
export const GET = route(async (_req, { user }) => {
  const now = new Date();
  const [upcoming, recent, counts, hb] = await Promise.all([
    prisma.notification.findMany({ where: { userId: user.id, status: 'pending' }, orderBy: { nextAttemptAt: 'asc' }, take: 15 }),
    prisma.notification.findMany({ where: { userId: user.id, status: { in: ['sent', 'failed', 'skipped'] } }, orderBy: { updatedAt: 'desc' }, take: 15 }),
    prisma.notification.groupBy({ by: ['status'], where: { userId: user.id }, _count: true }),
    prisma.workerHeartbeat.findUnique({ where: { name: 'worker' } }),
  ]);
  const overdue = await prisma.notification.count({ where: { userId: user.id, status: 'pending', nextAttemptAt: { lt: new Date(now.getTime() - 2 * 60_000) } } });
  const pick = (n: (typeof upcoming)[number]) => ({
    id: n.id, title: n.title, body: n.body, status: n.status, fireAt: n.fireAt, nextAttemptAt: n.nextAttemptAt,
    sentAt: n.sentAt, acceptedCount: n.acceptedCount, lastError: n.lastError, attempts: n.attempts, sourceType: n.sourceType,
  });
  return {
    upcoming: upcoming.map(pick),
    recent: recent.map(pick),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    worker: hb ? { beatAt: hb.beatAt, ageSeconds: Math.round((now.getTime() - hb.beatAt.getTime()) / 1000) } : null,
    overdue,
  };
});
