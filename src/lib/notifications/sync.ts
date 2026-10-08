// Reconciles the durable queue with the reminders a source should have.
// - pending reminders that are no longer wanted → cancelled
// - wanted reminders that were cancelled earlier → pending again
// - already sent / in-flight reminders are never touched (no re-sends)
import { prisma } from '../db';
import { getSettings } from '../services/settings';
import { desiredForBirthday, desiredForDeadline, desiredForTask, type DesiredNotification } from './plan';

type Source = 'task' | 'birthday' | 'deadline';

export async function applyDesired(userId: string, sourceType: Source, sourceId: string, desired: DesiredNotification[]) {
  const keys = desired.map((d) => d.dedupeKey);
  await prisma.$transaction(async (tx) => {
    await tx.notification.updateMany({
      where: { userId, sourceType, sourceId, status: 'pending', dedupeKey: { notIn: keys } },
      data: { status: 'cancelled', lockedAt: null },
    });
    if (!desired.length) return;
    const existing = await tx.notification.findMany({ where: { dedupeKey: { in: keys } }, select: { dedupeKey: true, status: true } });
    const byKey = new Map(existing.map((e) => [e.dedupeKey, e.status]));
    const fresh = desired.filter((d) => !byKey.has(d.dedupeKey));
    if (fresh.length) {
      await tx.notification.createMany({
        data: fresh.map((d) => ({
          userId, sourceType, sourceId, dedupeKey: d.dedupeKey, fireAt: d.fireAt, nextAttemptAt: d.fireAt,
          title: d.title, body: d.body, url: d.url,
        })),
        skipDuplicates: true,
      });
    }
    for (const d of desired) {
      const st = byKey.get(d.dedupeKey);
      if (st === 'cancelled' || st === 'pending') {
        await tx.notification.update({
          where: { dedupeKey: d.dedupeKey },
          data: { status: 'pending', fireAt: d.fireAt, nextAttemptAt: d.fireAt, title: d.title, body: d.body, url: d.url, attempts: 0, lastError: null },
        });
      }
    }
  });
}

export async function cancelSource(userId: string, sourceType: Source | 'snooze', sourceId: string, keyPrefix?: string) {
  await prisma.notification.updateMany({
    where: { userId, sourceType, sourceId, status: 'pending', ...(keyPrefix ? { dedupeKey: { startsWith: keyPrefix } } : {}) },
    data: { status: 'cancelled' },
  });
}

export async function syncTaskNotifications(taskId: string, now = new Date()) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { recurrence: true, occurrences: true } });
  if (!task) return;
  const s = await getSettings(task.userId);
  const desired = desiredForTask(task, task.recurrence, task.occurrences, { now, dateReminderTime: s.dateReminderTime });
  await applyDesired(task.userId, 'task', task.id, desired);
  if (task.status !== 'todo') await cancelSource(task.userId, 'snooze', task.id);
  else for (const o of task.occurrences) if (o.status !== 'todo') await cancelSource(task.userId, 'snooze', task.id, `snooze:${task.id}:${o.date}:`);
}

export async function syncBirthdayNotifications(id: string, now = new Date()) {
  const b = await prisma.birthday.findUnique({ where: { id } });
  if (!b) return;
  const s = await getSettings(b.userId);
  await applyDesired(b.userId, 'birthday', b.id, desiredForBirthday(b, { now, tz: s.timezone, dateReminderTime: s.dateReminderTime }));
}

export async function syncDeadlineNotifications(id: string, now = new Date()) {
  const d = await prisma.deadline.findUnique({ where: { id } });
  if (!d) return;
  const s = await getSettings(d.userId);
  await applyDesired(d.userId, 'deadline', d.id, desiredForDeadline(d, { now, tz: s.timezone, dateReminderTime: s.dateReminderTime }));
}

/** Rolls recurring horizons forward and re-applies settings changes (worker, every few minutes). */
export async function resyncUser(userId: string, now = new Date()) {
  const [tasks, birthdays, deadlines] = await Promise.all([
    prisma.task.findMany({ where: { userId, status: 'todo' }, select: { id: true } }),
    prisma.birthday.findMany({ where: { userId }, select: { id: true } }),
    prisma.deadline.findMany({ where: { userId, archived: false }, select: { id: true } }),
  ]);
  for (const t of tasks) await syncTaskNotifications(t.id, now);
  for (const b of birthdays) await syncBirthdayNotifications(b.id, now);
  for (const d of deadlines) await syncDeadlineNotifications(d.id, now);
}
