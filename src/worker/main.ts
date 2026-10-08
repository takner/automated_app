// Background worker: delivers reminders from the PostgreSQL queue, keeps recurring reminder
// horizons rolling, syncs Google Calendar, and cleans up. Independent of any open browser tab.
import { writeFileSync } from 'node:fs';
import { prisma } from '@/lib/db';
import { log } from '@/lib/log';
import { processDue } from '@/lib/notifications/sender';
import { resyncUser } from '@/lib/notifications/sync';
import { syncConnection } from '@/lib/google/calendar';
import { features } from '@/lib/env';

const HEARTBEAT_FILE = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/hamrooz-worker.alive';
const TICK_MS = 20_000;

const jobs = [
  { name: 'notifications', everyMs: TICK_MS, run: async () => ({ processed: await processDue() }) },
  {
    name: 'resync',
    everyMs: 10 * 60_000,
    run: async () => {
      const users = await prisma.user.findMany({ select: { id: true } });
      for (const u of users) await resyncUser(u.id);
      return { users: users.length };
    },
  },
  {
    name: 'calendar',
    everyMs: 15 * 60_000,
    run: async () => {
      if (!features().google) return { skipped: 'not_configured' };
      const conns = await prisma.calendarConnection.findMany({ where: { status: { not: 'revoked' } } });
      let ok = 0;
      for (const c of conns) {
        try {
          await syncConnection(c);
          ok++;
        } catch {
          // error recorded on the connection itself
        }
      }
      return { connections: conns.length, ok };
    },
  },
  {
    name: 'cleanup',
    everyMs: 6 * 3600_000,
    run: async () => {
      const now = new Date();
      const old = new Date(now.getTime() - 90 * 86400_000);
      const [s, o, n, p] = await Promise.all([
        prisma.session.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } }),
        prisma.notification.deleteMany({ where: { status: { in: ['sent', 'cancelled', 'skipped', 'failed'] }, updatedAt: { lt: old } } }),
        prisma.dailyPlan.deleteMany({ where: { status: 'discarded', createdAt: { lt: new Date(now.getTime() - 30 * 86400_000) } } }),
      ]);
      return { sessions: s.count, states: o.count, notifications: n.count, plans: p.count };
    },
  },
];

const lastRun = new Map<string, number>();
let stopping = false;

async function beat(info: Record<string, unknown>) {
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { name: 'worker' },
    create: { name: 'worker', beatAt: now, info: info as object },
    update: { beatAt: now, info: info as object },
  });
  try {
    writeFileSync(HEARTBEAT_FILE, String(now.getTime()));
  } catch {
    // heartbeat file is only for the container healthcheck
  }
}

async function tick() {
  const results: Record<string, unknown> = { release: process.env.APP_RELEASE ?? 'dev' };
  for (const job of jobs) {
    const prev = lastRun.get(job.name) ?? 0;
    if (Date.now() - prev < job.everyMs) continue;
    lastRun.set(job.name, Date.now());
    try {
      const r = await job.run();
      results[job.name] = r;
      if (job.name !== 'notifications' || (r as { processed: number }).processed) log.info(`job ${job.name}`, r as Record<string, unknown>);
    } catch (err) {
      results[job.name] = { error: true };
      log.error(`job ${job.name} failed`, { err });
    }
  }
  await beat(results);
}

async function main() {
  log.info('worker starting', { release: process.env.APP_RELEASE ?? 'dev' });
  const shutdown = () => {
    stopping = true;
    log.info('worker stopping');
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  while (!stopping) {
    try {
      await tick();
    } catch (err) {
      log.error('worker tick failed', { err });
    }
    for (let waited = 0; waited < TICK_MS && !stopping; waited += 500) await new Promise((r) => setTimeout(r, 500));
  }
  await prisma.$disconnect();
  process.exit(0);
}

main();
