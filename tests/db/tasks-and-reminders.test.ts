import { describe, expect, it, beforeEach } from 'vitest';
import { prisma } from '@/lib/db';
import { addDays, todayIn, zonedToUtc } from '@/lib/dates';
import { createTask, dayView, deleteTask, setItemStatus, updateOccurrence, updateTask } from '@/lib/services/tasks';
import { createDeadline, renewDeadline, createBirthday } from '@/lib/services/dates-service';
import { claimDue, processDue, processNotification } from '@/lib/notifications/sender';
import type { PushSender } from '@/lib/notifications/push';
import { makeUser, pending } from './helpers';

const TZ = 'Asia/Tehran';
let userId: string;
const today = () => todayIn(TZ);

beforeEach(async () => {
  userId = (await makeUser()).id;
});

describe('task lifecycle', () => {
  it('create → shows in today → complete', async () => {
    const t = await createTask(userId, { title: 'خرید نان', scheduledDate: today(), scheduledTime: '23:00', durationMinutes: 15 });
    let v = await dayView(userId);
    expect(v.items.map((i) => i.taskId)).toContain(t.id);
    await setItemStatus(userId, t.id, 'done');
    v = await dayView(userId);
    expect(v.items.find((i) => i.taskId === t.id)?.status).toBe('done');
  });

  it('other users cannot touch the task', async () => {
    const t = await createTask(userId, { title: 'خصوصی' });
    const other = await makeUser();
    await expect(setItemStatus(other.id, t.id, 'done')).rejects.toMatchObject({ status: 404 });
    await expect(updateTask(other.id, t.id, { title: 'x' })).rejects.toMatchObject({ status: 404 });
    await expect(deleteTask(other.id, t.id)).rejects.toMatchObject({ status: 404 });
    expect((await dayView(other.id)).unscheduled).toHaveLength(0);
  });

  it('overdue tasks are not moved silently', async () => {
    const t = await createTask(userId, { title: 'گزارش', dueDate: addDays(today(), -2) });
    const v = await dayView(userId);
    expect(v.overdue.map((i) => i.taskId)).toEqual([t.id]);
    const row = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.dueDate).toBe(addDays(today(), -2));
  });
});

describe('recurrence occurrences', () => {
  it('completing one occurrence leaves the series and other occurrences intact', async () => {
    const t = await createTask(userId, {
      title: 'ورزش',
      recurrence: { freq: 'daily', startDate: today(), time: '22:00' },
      reminderOffsets: [10],
    });
    const occ = `${t.id}@${today()}`;
    await setItemStatus(userId, occ, 'done');
    const task = await prisma.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(task.status).toBe('todo');
    const tomorrow = await dayView(userId, addDays(today(), 1));
    expect(tomorrow.items.find((i) => i.taskId === t.id)?.status).toBe('todo');
    expect((await dayView(userId)).items.find((i) => i.taskId === t.id)?.status).toBe('done');
    // reminders: today's is cancelled, tomorrow's still pending
    const p = await pending(userId);
    expect(p.some((n) => n.dedupeKey.includes(`:${today()}:`))).toBe(false);
    expect(p.some((n) => n.dedupeKey.includes(`:${addDays(today(), 1)}:`))).toBe(true);
  });

  it('editing one occurrence differs from editing the series', async () => {
    const t = await createTask(userId, { title: 'کلاس', recurrence: { freq: 'daily', startDate: today(), time: '20:00' } });
    const d1 = addDays(today(), 1);
    await updateOccurrence(userId, t.id, d1, { title: 'کلاس جبرانی', time: '21:00' });
    const v1 = await dayView(userId, d1);
    expect(v1.items[0]).toMatchObject({ title: 'کلاس جبرانی', start: zonedToUtc(d1, '21:00', TZ).toISOString() });
    const v2 = await dayView(userId, addDays(today(), 2));
    expect(v2.items[0]).toMatchObject({ title: 'کلاس' });
    await updateTask(userId, t.id, { title: 'کلاس زبان' });
    expect((await dayView(userId, addDays(today(), 2))).items[0].title).toBe('کلاس زبان');
    expect((await dayView(userId, d1)).items[0].title).toBe('کلاس جبرانی');
  });
});

describe('reminder cancellation', () => {
  const future = () => addDays(today(), 3);

  it('editing the time replaces the reminder', async () => {
    const t = await createTask(userId, { title: 'دندانپزشکی', scheduledDate: future(), scheduledTime: '17:00', reminderOffsets: [60] });
    const [first] = await pending(userId);
    expect(first.fireAt.toISOString()).toBe(zonedToUtc(future(), '16:00', TZ).toISOString());
    await updateTask(userId, t.id, { scheduledTime: '18:00' });
    const p = await pending(userId);
    expect(p).toHaveLength(1);
    expect(p[0].fireAt.toISOString()).toBe(zonedToUtc(future(), '17:00', TZ).toISOString());
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('cancelled');
  });

  it('completing and deleting cancel pending reminders', async () => {
    const a = await createTask(userId, { title: 'a', scheduledDate: future(), scheduledTime: '10:00', reminderOffsets: [30, 0] });
    const b = await createTask(userId, { title: 'b', scheduledDate: future(), scheduledTime: '11:00', reminderOffsets: [30] });
    expect(await pending(userId)).toHaveLength(3);
    await setItemStatus(userId, a.id, 'done');
    expect((await pending(userId)).map((n) => n.sourceId)).toEqual([b.id]);
    await deleteTask(userId, b.id);
    expect(await pending(userId)).toHaveLength(0);
    // undo completion brings the reminders back (same logical keys, no duplicates)
    await setItemStatus(userId, a.id, 'todo');
    expect(await pending(userId)).toHaveLength(2);
    expect(await prisma.notification.count({ where: { userId } })).toBe(3);
  });

  it('renewing a deadline records history and moves its reminders', async () => {
    const due = addDays(today(), 40);
    const d = await createDeadline(userId, { title: 'بیمه ماشین', kind: 'insurance', dueDate: due, reminderDays: [30, 7, 1] });
    expect(await pending(userId)).toHaveLength(3);
    const next = addDays(due, 365);
    await renewDeadline(userId, d.id, { newDueDate: next });
    const p = await pending(userId);
    expect(p).toHaveLength(3);
    expect(p.every((n) => n.dedupeKey.includes(next))).toBe(true);
    expect(await prisma.deadlineRenewal.count({ where: { deadlineId: d.id } })).toBe(1);
    await expect(renewDeadline(userId, d.id, { newDueDate: due })).rejects.toMatchObject({ status: 400 });
  });

  it('jalali birthday reminders land on the jalali date', async () => {
    await createBirthday(userId, { name: 'سارا', calendar: 'jalali', month: 1, day: 1, reminderDays: [0] });
    const [n] = await pending(userId);
    const { toJalali, utcToLocal } = await import('@/lib/dates');
    expect(toJalali(utcToLocal(n.fireAt, TZ).date)).toMatchObject({ m: 1, d: 1 });
  });
});

describe('queue delivery', () => {
  async function dueNotification() {
    const n = await prisma.notification.create({
      data: { userId, sourceType: 'task', sourceId: 'x', dedupeKey: `t:${Math.random()}`, fireAt: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000), title: 't', body: 'b' },
    });
    await prisma.pushSubscription.create({ data: { userId, endpoint: `https://push.example/${Math.random()}`, p256dh: 'k', auth: 'a' } });
    return n;
  }

  it('concurrent claims never return the same row twice', async () => {
    for (let i = 0; i < 10; i++) {
      await prisma.notification.create({
        data: { userId, sourceType: 'task', sourceId: 'x', dedupeKey: `c:${i}`, fireAt: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000), title: 't', body: 'b' },
      });
    }
    const [a, b, c] = await Promise.all([claimDue(5), claimDue(5), claimDue(5)]);
    const ids = [...a, ...b, ...c].map((n) => n.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it('sends once, records acceptance, and does not resend', async () => {
    const n = await dueNotification();
    let sends = 0;
    const send: PushSender = async () => {
      sends++;
      return { ok: true, status: 201 };
    };
    await processDue({ send });
    await processDue({ send });
    expect(sends).toBe(1);
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row).toMatchObject({ status: 'sent', acceptedCount: 1 });
  });

  it('retries transient failures with backoff, then gives up', async () => {
    const n = await dueNotification();
    const send: PushSender = async () => ({ ok: false, gone: false, transient: true, status: 503, error: 'push_error_503' });
    let now = new Date();
    for (let i = 0; i < 6; i++) {
      await processDue({ send, now });
      now = new Date(now.getTime() + 60 * 60_000);
    }
    const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
    expect(row.status).toBe('failed');
    expect(row.attempts).toBe(4);
  });

  it('drops expired subscriptions (410)', async () => {
    const n = await dueNotification();
    const send: PushSender = async () => ({ ok: false, gone: true, transient: false, status: 410, error: 'subscription_expired' });
    await processDue({ send });
    expect(await prisma.pushSubscription.count({ where: { userId } })).toBe(0);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).status).toBe('failed');
  });

  it('defers during quiet hours and respects the global switch', async () => {
    const n = await dueNotification();
    await prisma.userSettings.update({ where: { userId }, data: { quietStart: '00:00', quietEnd: '23:59' } });
    const claimed = (await claimDue())[0];
    const send: PushSender = async () => ({ ok: true, status: 201 });
    expect((await processNotification(claimed, { send })).status).toBe('deferred');
    await prisma.userSettings.update({ where: { userId }, data: { quietStart: null, quietEnd: null, notificationsEnabled: false } });
    await prisma.notification.update({ where: { id: n.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    const again = (await claimDue())[0];
    expect((await processNotification(again, { send })).status).toBe('skipped');
  });
});
