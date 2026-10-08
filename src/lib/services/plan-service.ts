// Gathers planner inputs from the database, stores the proposal as a draft, and applies it
// only when the user accepts. Accepting sets planned start times on tasks; it never edits
// external calendar events.
import { prisma } from '../db';
import { HttpError, notFound } from '../errors';
import { addDays, isLocalDate, startOfLocalDay, todayIn, utcToLocal, weekday, zonedToUtc, type LocalDate } from '../dates';
import { planDay, type FixedItem, type Level, type PlanResult, type PlanTask } from '../planner';
import { dayView, getOwnedTask, parseKey, updateOccurrence, type TaskItem } from './tasks';
import { getSettings } from './settings';
import { syncTaskNotifications } from '../notifications/sync';

export async function getEnergy(userId: string, date: LocalDate): Promise<Level> {
  const e = await prisma.dayEnergy.findUnique({ where: { userId_date: { userId, date } } });
  return (e?.energy as Level) ?? 'medium';
}

export async function setEnergy(userId: string, date: LocalDate, energy: Level) {
  if (!isLocalDate(date)) throw new HttpError(400, 'تاریخ نامعتبر');
  await prisma.dayEnergy.upsert({ where: { userId_date: { userId, date } }, create: { userId, date, energy }, update: { energy } });
}

export async function calendarEventsForDay(userId: string, date: LocalDate, tz: string) {
  const start = startOfLocalDay(date, tz);
  const end = startOfLocalDay(addDays(date, 1), tz);
  return prisma.calendarEvent.findMany({
    where: {
      userId,
      source: { selected: true },
      OR: [
        { allDay: false, start: { lt: end }, end: { gt: start } },
        { allDay: true, startDate: { lte: date }, endDate: { gt: date } },
      ],
    },
    orderBy: [{ allDay: 'desc' }, { start: 'asc' }],
  });
}

function toPlanTask(i: TaskItem): PlanTask {
  return {
    key: i.key,
    taskId: i.taskId,
    occurrenceDate: i.occurrenceDate ?? undefined,
    title: i.title,
    category: i.category,
    priority: i.priority,
    energy: i.energy,
    durationMinutes: i.durationMinutes,
    dueDate: i.dueDate ?? (i.recurring ? i.date : null),
    overdue: i.overdue,
  };
}

export async function computePlan(userId: string, date?: LocalDate, now = new Date()): Promise<PlanResult> {
  const s = await getSettings(userId);
  const tz = s.timezone;
  const today = todayIn(tz, now);
  const day = date ?? today;
  if (day < today) throw new HttpError(400, 'برای روزهای گذشته برنامه ساخته نمی‌شود');
  const view = await dayView(userId, day, now);
  const [blocks, events, energy] = await Promise.all([
    prisma.fixedBlock.findMany({ where: { userId } }),
    calendarEventsForDay(userId, day, tz),
    getEnergy(userId, day),
  ]);
  const wd = weekday(day);
  const fixed: FixedItem[] = [];
  for (const b of blocks) {
    if (!b.days.includes(wd)) continue;
    fixed.push({ title: b.title, start: zonedToUtc(day, b.start, tz), end: zonedToUtc(day, b.end, tz), kind: 'block', blockKind: b.kind });
  }
  for (const e of events) {
    if (e.allDay || e.transparent || e.fromApp || !e.start || !e.end) continue;
    fixed.push({ title: e.summary, start: e.start, end: e.end, kind: 'event' });
  }
  const candidates: TaskItem[] = [];
  for (const i of view.items) {
    if (i.status !== 'todo') continue;
    if (i.start) {
      const end = new Date(new Date(i.start).getTime() + (i.durationMinutes ?? 30) * 60_000);
      fixed.push({ title: i.title, start: new Date(i.start), end, kind: 'task' });
    } else candidates.push(i);
  }
  // missed occurrences of recurring tasks are decided by the user (move/skip), not re-planned
  if (day === today) candidates.push(...view.overdue.filter((i) => !i.recurring));
  candidates.push(...view.unscheduled);
  candidates.push(...view.upcoming.filter((u) => u.dueDate && u.dueDate <= addDays(day, 3) && !u.start));

  return planDay({
    date: day,
    tz,
    now: day === today ? now : undefined,
    settings: s,
    energy,
    fixed,
    tasks: candidates.map(toPlanTask),
  });
}

export async function createDraft(userId: string, date?: LocalDate) {
  const plan = await computePlan(userId, date);
  await prisma.dailyPlan.updateMany({ where: { userId, date: plan.date, status: 'draft' }, data: { status: 'discarded' } });
  const row = await prisma.dailyPlan.create({
    data: {
      userId,
      date: plan.date,
      blocks: plan.blocks as object[],
      unscheduled: plan.unscheduled as object[],
      summary: { ...plan.summary, warnings: plan.warnings, topPriorities: plan.topPriorities },
    },
  });
  return { id: row.id, ...plan };
}

export async function latestPlan(userId: string, date: LocalDate) {
  return prisma.dailyPlan.findFirst({ where: { userId, date, status: { in: ['draft', 'accepted'] } }, orderBy: { createdAt: 'desc' } });
}

/** Apply the selected task blocks of a draft as planned start times. */
export async function acceptPlan(userId: string, planId: string, keys?: string[]) {
  const plan = await prisma.dailyPlan.findFirst({ where: { id: planId, userId } });
  if (!plan) throw notFound();
  if (plan.status !== 'draft') throw new HttpError(409, 'این برنامه قبلاً تأیید یا کنار گذاشته شده است');
  const s = await getSettings(userId);
  const blocks = plan.blocks as unknown as Array<{ kind: string; start: string; taskKey?: string }>;
  const chosen = blocks.filter((b) => b.kind === 'task' && b.taskKey && (!keys || keys.includes(b.taskKey)));
  for (const b of chosen) {
    const { taskId, occ } = parseKey(b.taskKey!);
    const start = new Date(b.start);
    if (occ) {
      const l = utcToLocal(start, s.timezone);
      await updateOccurrence(userId, taskId, occ, { date: l.date, time: l.time });
    } else {
      const task = await getOwnedTask(userId, taskId);
      if (task.status !== 'todo') continue;
      await prisma.task.update({ where: { id: taskId }, data: { scheduledStart: start } });
      await syncTaskNotifications(taskId);
    }
  }
  await prisma.dailyPlan.update({ where: { id: planId }, data: { status: 'accepted', acceptedAt: new Date() } });
  return { applied: chosen.length };
}
