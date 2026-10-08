// Worker side of the queue. A row is claimed with FOR UPDATE SKIP LOCKED, so two workers (or
// a worker and a manual test send) never deliver the same reminder twice.
import { prisma } from '../db';
import { minutesOfDay, utcToLocal, zonedToUtc, addDays } from '../dates';
import { log } from '../log';
import { sendPush, type PushSender } from './push';
import type { Notification } from '@/generated/prisma/client';

export const MAX_ATTEMPTS = 4;
const BACKOFF_MIN = [1, 5, 15];
const STALE_MS = 6 * 3600_000;
const LOCK_TIMEOUT_MS = 5 * 60_000;

export async function claimDue(limit = 20, now = new Date()): Promise<Notification[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Notification"
       SET "status" = 'processing'::"NotificationStatus", "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
     WHERE "id" IN (
       SELECT "id" FROM "Notification"
        WHERE "status" = 'pending'::"NotificationStatus" AND "nextAttemptAt" <= ${now}
        ORDER BY "nextAttemptAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED)
    RETURNING "id"`;
  if (!rows.length) return [];
  return prisma.notification.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { nextAttemptAt: 'asc' } });
}

/** Claim one specific row (manual "send test now"). */
export async function claimOne(id: string, now = new Date()): Promise<Notification | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Notification"
       SET "status" = 'processing'::"NotificationStatus", "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
     WHERE "id" = ${id} AND "status" = 'pending'::"NotificationStatus"
    RETURNING "id"`;
  if (!rows.length) return null;
  return prisma.notification.findUnique({ where: { id } });
}

/** Rows stuck in `processing` (worker crashed mid-send) go back to the queue. */
export async function releaseStale(now = new Date()) {
  const r = await prisma.notification.updateMany({
    where: { status: 'processing', lockedAt: { lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } },
    data: { status: 'pending', lockedAt: null, nextAttemptAt: now },
  });
  if (r.count) log.warn('released stale notifications', { count: r.count });
}

export function quietUntil(now: Date, tz: string, quietStart: string | null, quietEnd: string | null): Date | null {
  if (!quietStart || !quietEnd || quietStart === quietEnd) return null;
  const l = utcToLocal(now, tz);
  const m = minutesOfDay(l.time);
  const s = minutesOfDay(quietStart);
  const e = minutesOfDay(quietEnd);
  const inQuiet = s < e ? m >= s && m < e : m >= s || m < e;
  if (!inQuiet) return null;
  const endDate = s < e || m < e ? l.date : addDays(l.date, 1);
  return zonedToUtc(endDate, quietEnd, tz);
}

export interface ProcessOutcome {
  status: 'sent' | 'failed' | 'skipped' | 'deferred' | 'retry';
  accepted: number;
  detail?: string;
}

export async function processNotification(n: Notification, opts: { send?: PushSender; now?: Date; ignoreQuiet?: boolean } = {}): Promise<ProcessOutcome> {
  const send = opts.send ?? sendPush;
  const now = opts.now ?? new Date();
  const settings = await prisma.userSettings.findUnique({ where: { userId: n.userId } });
  const finish = async (status: 'sent' | 'failed' | 'skipped', data: Partial<Notification> = {}) => {
    await prisma.notification.update({ where: { id: n.id }, data: { status, lockedAt: null, ...data } });
  };

  if (n.sourceType !== 'test' && settings && !settings.notificationsEnabled) {
    await finish('skipped', { lastError: 'notifications_disabled' });
    return { status: 'skipped', accepted: 0, detail: 'notifications_disabled' };
  }
  if (n.sourceType !== 'test' && now.getTime() - n.nextAttemptAt.getTime() > STALE_MS) {
    await finish('skipped', { lastError: 'expired' });
    return { status: 'skipped', accepted: 0, detail: 'expired' };
  }
  if (!opts.ignoreQuiet && n.sourceType !== 'test' && settings) {
    const until = quietUntil(now, settings.timezone, settings.quietStart, settings.quietEnd);
    if (until) {
      await prisma.notification.update({
        where: { id: n.id },
        data: { status: 'pending', lockedAt: null, nextAttemptAt: until, attempts: { decrement: 1 }, lastError: 'deferred_quiet_hours' },
      });
      return { status: 'deferred', accepted: 0, detail: until.toISOString() };
    }
  }

  const subs = await prisma.pushSubscription.findMany({ where: { userId: n.userId } });
  if (!subs.length) {
    await finish('failed', { lastError: 'no_subscription' });
    return { status: 'failed', accepted: 0, detail: 'no_subscription' };
  }
  const preview = settings?.notificationPreview ?? true;
  const payload = {
    title: preview ? n.title : 'هم‌روز',
    body: preview ? n.body : 'یک یادآوری تازه دارید.',
    url: n.url,
    tag: n.id,
  };

  let accepted = 0;
  let transient = 0;
  const errors: string[] = [];
  for (const s of subs) {
    const r = await send(s, payload);
    if (r.ok) {
      accepted++;
      await prisma.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: now, failureCount: 0 } });
    } else {
      errors.push(r.error);
      if (r.gone) await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      else {
        if (r.transient) transient++;
        await prisma.pushSubscription.update({ where: { id: s.id }, data: { failureCount: { increment: 1 } } }).catch(() => {});
      }
    }
  }

  if (accepted > 0) {
    await finish('sent', { sentAt: now, acceptedCount: accepted, lastError: errors.length ? errors.join(',').slice(0, 300) : null });
    return { status: 'sent', accepted };
  }
  if (transient > 0 && n.attempts < MAX_ATTEMPTS) {
    const delay = BACKOFF_MIN[Math.min(n.attempts - 1, BACKOFF_MIN.length - 1)] * 60_000;
    await prisma.notification.update({
      where: { id: n.id },
      data: { status: 'pending', lockedAt: null, nextAttemptAt: new Date(now.getTime() + delay), lastError: errors.join(',').slice(0, 300) },
    });
    return { status: 'retry', accepted: 0, detail: errors.join(',') };
  }
  await finish('failed', { lastError: errors.join(',').slice(0, 300) || 'unknown' });
  return { status: 'failed', accepted: 0, detail: errors.join(',') };
}

export async function processDue(opts: { send?: PushSender; now?: Date } = {}) {
  await releaseStale(opts.now);
  let total = 0;
  for (;;) {
    const batch = await claimDue(20, opts.now);
    if (!batch.length) break;
    for (const n of batch) {
      try {
        await processNotification(n, opts);
      } catch (err) {
        log.error('notification processing failed', { id: n.id, err });
        const giveUp = n.attempts >= MAX_ATTEMPTS;
        await prisma.notification
          .update({
            where: { id: n.id },
            data: giveUp
              ? { status: 'failed', lockedAt: null, lastError: 'internal_error' }
              : { status: 'pending', lockedAt: null, nextAttemptAt: new Date(Date.now() + 60_000) },
          })
          .catch(() => {});
      }
      total++;
    }
    if (batch.length < 20) break;
  }
  return total;
}
