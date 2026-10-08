import { z } from 'zod';
import { prisma } from '../db';
import { HttpError, notFound } from '../errors';
import {
  addDays,
  isLocalDate,
  isTimeOfDay,
  todayIn,
  utcToLocal,
  zonedToUtc,
  startOfLocalDay,
  type LocalDate,
} from '../dates';
import { expandRule } from '../recurrence';
import { cancelSource, syncTaskNotifications } from '../notifications/sync';
import { getSettings } from './settings';
import type { Prisma, Task, TaskOccurrence, TaskRecurrence } from '@/generated/prisma/client';

const localDate = z.string().refine(isLocalDate, 'تاریخ نامعتبر');
const timeOfDay = z.string().refine(isTimeOfDay, 'ساعت نامعتبر');
const level = z.enum(['low', 'medium', 'high']);

export const recurrenceInput = z.object({
  freq: z.enum(['daily', 'weekly', 'monthly', 'yearly']),
  interval: z.number().int().min(1).max(52).default(1),
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  calendar: z.enum(['jalali', 'gregorian']).default('jalali'),
  startDate: localDate,
  untilDate: localDate.nullish(),
  time: timeOfDay.nullish(),
  monthEndPolicy: z.enum(['clamp', 'skip']).default('clamp'),
});

// Base fields carry no defaults: in Zod 4 `.partial()` would still apply defaults and a
// partial update would silently reset untouched fields.
const taskBase = z.object({
  title: z.string().trim().min(1, 'عنوان لازم است').max(200),
  description: z.string().max(5000).nullish(),
  category: z.enum(['personal', 'work']),
  priority: level,
  energy: level.nullish(),
  dueDate: localDate.nullish(),
  dueTime: timeOfDay.nullish(),
  scheduledDate: localDate.nullish(),
  scheduledTime: timeOfDay.nullish(),
  durationMinutes: z.number().int().min(1).max(1440).nullish(),
  reminderOffsets: z.array(z.number().int().min(0).max(60 * 24 * 60)).max(10),
  reminderAnchor: z.enum(['start', 'due']),
  recurrence: recurrenceInput.nullish(),
});
export const taskInput = taskBase.extend({
  category: taskBase.shape.category.default('personal'),
  priority: taskBase.shape.priority.default('medium'),
  reminderOffsets: taskBase.shape.reminderOffsets.default([]),
  reminderAnchor: taskBase.shape.reminderAnchor.default('start'),
});
export type TaskInput = z.infer<typeof taskInput>;
export const taskPatch = taskBase.partial();

export const occurrencePatch = z.object({
  title: z.string().trim().min(1).max(200).nullish(),
  date: localDate.nullish(), // move to another day
  time: timeOfDay.nullish(),
  durationMinutes: z.number().int().min(1).max(1440).nullish(),
});

type FullTask = Task & { recurrence: TaskRecurrence | null; occurrences: TaskOccurrence[] };

export interface TaskItem {
  key: string;
  taskId: string;
  occurrenceDate: string | null;
  title: string;
  description: string | null;
  category: 'personal' | 'work';
  priority: 'low' | 'medium' | 'high';
  energy: 'low' | 'medium' | 'high' | null;
  durationMinutes: number | null;
  status: 'todo' | 'done' | 'skipped' | 'cancelled';
  date: LocalDate | null; // the day this item belongs to (scheduled day, due day, or occurrence day)
  dueDate: LocalDate | null;
  dueTime: string | null;
  start: string | null; // ISO instant when a time is set
  recurring: boolean;
  overdue: boolean;
  reminderOffsets: number[];
}

export function itemKey(taskId: string, occ?: string | null) {
  return occ ? `${taskId}@${occ}` : taskId;
}

export function parseKey(key: string): { taskId: string; occ: string | null } {
  const [taskId, occ] = key.split('@');
  if (!taskId || (occ != null && !isLocalDate(occ))) throw new HttpError(400, 'شناسهٔ نامعتبر');
  return { taskId, occ: occ ?? null };
}

function computeDueAt(dueDate: string | null | undefined, dueTime: string | null | undefined, tz: string): Date | null {
  if (!dueDate) return null;
  return zonedToUtc(dueDate, dueTime ?? '23:59', tz);
}

function scheduledFrom(input: Pick<TaskInput, 'scheduledDate' | 'scheduledTime'>, tz: string): Date | null {
  if (input.scheduledDate && input.scheduledTime) return zonedToUtc(input.scheduledDate, input.scheduledTime, tz);
  return null;
}

export async function getOwnedTask(userId: string, id: string): Promise<FullTask> {
  const t = await prisma.task.findFirst({ where: { id, userId }, include: { recurrence: true, occurrences: true } });
  if (!t) throw notFound();
  return t;
}

export async function createTask(userId: string, raw: unknown): Promise<Task> {
  const input = taskInput.parse(raw);
  const s = await getSettings(userId);
  const tz = s.timezone;
  const task = await prisma.task.create({
    data: {
      userId,
      title: input.title,
      description: input.description ?? null,
      category: input.category,
      priority: input.priority,
      energy: input.energy ?? null,
      dueDate: input.recurrence ? null : (input.dueDate ?? null),
      dueTime: input.recurrence ? null : input.dueDate ? (input.dueTime ?? null) : null,
      dueAt: input.recurrence ? null : computeDueAt(input.dueDate, input.dueTime, tz),
      scheduledStart: input.recurrence ? null : scheduledFrom(input, tz),
      durationMinutes: input.durationMinutes ?? null,
      timezone: tz,
      reminderOffsets: [...new Set(input.reminderOffsets)].sort((a, b) => b - a),
      reminderAnchor: input.reminderAnchor,
      recurrence: input.recurrence
        ? {
            create: {
              ...input.recurrence,
              untilDate: input.recurrence.untilDate ?? null,
              time: input.recurrence.time ?? null,
            },
          }
        : undefined,
    },
  });
  await syncTaskNotifications(task.id);
  return task;
}

/** Edit the whole task / series. */
export async function updateTask(userId: string, id: string, raw: unknown): Promise<Task> {
  const patch = taskPatch.parse(raw);
  const existing = await getOwnedTask(userId, id);
  const tz = existing.timezone;
  const data: Prisma.TaskUpdateInput = {};
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.description !== undefined) data.description = patch.description ?? null;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.priority !== undefined) data.priority = patch.priority;
  if (patch.energy !== undefined) data.energy = patch.energy ?? null;
  if (patch.durationMinutes !== undefined) data.durationMinutes = patch.durationMinutes ?? null;
  if (patch.reminderOffsets !== undefined) data.reminderOffsets = [...new Set(patch.reminderOffsets)].sort((a, b) => b - a);
  if (patch.reminderAnchor !== undefined) data.reminderAnchor = patch.reminderAnchor;
  if (patch.dueDate !== undefined || patch.dueTime !== undefined) {
    const dueDate = patch.dueDate !== undefined ? patch.dueDate : existing.dueDate;
    const dueTime = dueDate ? (patch.dueTime !== undefined ? patch.dueTime : existing.dueTime) : null;
    data.dueDate = dueDate ?? null;
    data.dueTime = dueTime ?? null;
    data.dueAt = computeDueAt(dueDate, dueTime, tz);
  }
  if (patch.scheduledDate !== undefined || patch.scheduledTime !== undefined) {
    const cur = existing.scheduledStart ? utcToLocal(existing.scheduledStart, tz) : null;
    const date = patch.scheduledDate !== undefined ? patch.scheduledDate : cur?.date;
    const time = patch.scheduledTime !== undefined ? patch.scheduledTime : cur?.time;
    data.scheduledStart = date && time ? zonedToUtc(date, time, tz) : null;
  }
  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id }, data });
    if (patch.recurrence === null) await tx.taskRecurrence.deleteMany({ where: { taskId: id } });
    else if (patch.recurrence) {
      const r = { ...patch.recurrence, untilDate: patch.recurrence.untilDate ?? null, time: patch.recurrence.time ?? null };
      await tx.taskRecurrence.upsert({ where: { taskId: id }, create: { taskId: id, ...r }, update: r });
    }
  });
  await syncTaskNotifications(id);
  return prisma.task.findUniqueOrThrow({ where: { id } });
}

export async function deleteTask(userId: string, id: string): Promise<void> {
  await getOwnedTask(userId, id);
  await cancelSource(userId, 'task', id);
  await cancelSource(userId, 'snooze', id);
  await prisma.task.delete({ where: { id } });
}

function assertOccurrence(task: FullTask, date: string) {
  if (!task.recurrence) throw new HttpError(400, 'این کار تکرارشونده نیست');
  const hit = expandRule(task.recurrence, date, date).length > 0 || task.occurrences.some((o) => o.date === date);
  if (!hit) throw new HttpError(400, 'این تاریخ جزو تکرارهای کار نیست');
}

export async function setItemStatus(userId: string, key: string, status: 'todo' | 'done' | 'skipped'): Promise<void> {
  const { taskId, occ } = parseKey(key);
  const task = await getOwnedTask(userId, taskId);
  if (occ) {
    assertOccurrence(task, occ);
    await prisma.taskOccurrence.upsert({
      where: { taskId_date: { taskId, date: occ } },
      create: { taskId, userId, date: occ, status, completedAt: status === 'done' ? new Date() : null },
      update: { status, completedAt: status === 'done' ? new Date() : null },
    });
  } else {
    if (status === 'skipped') throw new HttpError(400, 'رد کردن فقط برای نوبت‌های کار تکرارشونده است');
    if (task.recurrence) throw new HttpError(400, 'برای کار تکرارشونده، یک نوبت مشخص را انتخاب کنید');
    await prisma.task.update({ where: { id: taskId }, data: { status, completedAt: status === 'done' ? new Date() : null } });
  }
  await syncTaskNotifications(taskId);
}

/** Edit / move a single occurrence; the series stays as it is. */
export async function updateOccurrence(userId: string, taskId: string, date: string, raw: unknown): Promise<void> {
  const patch = occurrencePatch.parse(raw);
  const task = await getOwnedTask(userId, taskId);
  assertOccurrence(task, date);
  const row = task.occurrences.find((o) => o.date === date);
  const data: Prisma.TaskOccurrenceUncheckedUpdateInput = {};
  if (patch.title !== undefined) data.overrideTitle = patch.title ?? null;
  if (patch.durationMinutes !== undefined) data.overrideDuration = patch.durationMinutes ?? null;
  if (patch.date !== undefined || patch.time !== undefined) {
    const targetDate = patch.date ?? row?.movedToDate ?? date;
    data.movedToDate = targetDate === date ? null : targetDate;
    const time = patch.time !== undefined ? patch.time : row?.overrideStart ? utcToLocal(row.overrideStart, task.timezone).time : task.recurrence!.time;
    data.overrideStart = time ? zonedToUtc(targetDate, time, task.timezone) : null;
  }
  await prisma.taskOccurrence.upsert({
    where: { taskId_date: { taskId, date } },
    create: { taskId, userId, date, ...(data as object) },
    update: data,
  });
  await syncTaskNotifications(taskId);
}

/** Move an item (one-off or occurrence) to a day, optionally with a time. Used for overdue suggestions. */
export async function moveItem(userId: string, key: string, date: LocalDate, time: string | null): Promise<void> {
  const { taskId, occ } = parseKey(key);
  if (occ) return updateOccurrence(userId, taskId, occ, { date, time });
  const task = await getOwnedTask(userId, taskId);
  const patch: Record<string, unknown> = {};
  if (task.dueDate && task.dueDate < date) patch.dueDate = date;
  if (time) {
    patch.scheduledDate = date;
    patch.scheduledTime = time;
  } else if (task.scheduledStart) {
    patch.scheduledDate = null;
    patch.scheduledTime = null;
    if (!task.dueDate || task.dueDate < date) patch.dueDate = date;
  } else if (!task.dueDate) patch.dueDate = date;
  await updateTask(userId, taskId, patch);
}

// ───────────── views ─────────────

function baseItem(t: FullTask) {
  return {
    taskId: t.id,
    description: t.description,
    category: t.category,
    priority: t.priority,
    energy: t.energy,
    recurring: !!t.recurrence,
    reminderOffsets: t.reminderOffsets,
  };
}

export function oneOffItem(t: FullTask, today: LocalDate): TaskItem {
  const startLocal = t.scheduledStart ? utcToLocal(t.scheduledStart, t.timezone) : null;
  const date = startLocal?.date ?? t.dueDate ?? null;
  const overdue =
    t.status === 'todo' &&
    ((t.dueDate != null && t.dueDate < today) || (t.dueDate == null && startLocal != null && startLocal.date < today));
  return {
    ...baseItem(t),
    key: t.id,
    occurrenceDate: null,
    title: t.title,
    durationMinutes: t.durationMinutes,
    status: t.status,
    date,
    dueDate: t.dueDate,
    dueTime: t.dueTime,
    start: t.scheduledStart?.toISOString() ?? null,
    overdue,
  };
}

export function occurrenceItems(t: FullTask, from: LocalDate, to: LocalDate, today: LocalDate): TaskItem[] {
  if (!t.recurrence || t.status !== 'todo') return [];
  const rows = new Map(t.occurrences.map((o) => [o.date, o]));
  // occurrences whose original date OR moved date falls in range
  const dates = new Set(expandRule(t.recurrence, from, to).map((o) => o.date));
  for (const o of t.occurrences) {
    if (o.movedToDate && o.movedToDate >= from && o.movedToDate <= to) dates.add(o.date);
  }
  const out: TaskItem[] = [];
  for (const d of dates) {
    const row = rows.get(d);
    const effective = row?.movedToDate ?? d;
    if (effective < from || effective > to) continue;
    const start = row?.overrideStart ?? (t.recurrence.time ? zonedToUtc(effective, t.recurrence.time, t.timezone) : null);
    const status = row?.status ?? 'todo';
    out.push({
      ...baseItem(t),
      key: itemKey(t.id, d),
      occurrenceDate: d,
      title: row?.overrideTitle ?? t.title,
      durationMinutes: row?.overrideDuration ?? t.durationMinutes,
      status,
      date: effective,
      dueDate: null,
      dueTime: null,
      start: start?.toISOString() ?? null,
      overdue: status === 'todo' && effective < today,
    });
  }
  return out.sort((a, b) => (a.date! < b.date! ? -1 : 1));
}

export interface DayView {
  today: LocalDate;
  date: LocalDate;
  items: TaskItem[]; // belongs to `date`
  overdue: TaskItem[];
  unscheduled: TaskItem[]; // open one-off tasks without any date
  upcoming: TaskItem[]; // next 7 days (one-off with due date)
}

const RECURRING_OVERDUE_LOOKBACK = 2;

export async function dayView(userId: string, date?: LocalDate, now = new Date()): Promise<DayView> {
  const s = await getSettings(userId);
  const today = todayIn(s.timezone, now);
  const day = date ?? today;
  const tasks = await prisma.task.findMany({
    where: { userId, status: { in: ['todo', 'done'] } },
    include: { recurrence: true, occurrences: true },
    orderBy: { createdAt: 'asc' },
  });
  const items: TaskItem[] = [];
  const overdue: TaskItem[] = [];
  const unscheduled: TaskItem[] = [];
  const upcoming: TaskItem[] = [];
  const dayStart = startOfLocalDay(day, s.timezone);
  for (const t of tasks) {
    if (t.recurrence) {
      items.push(...occurrenceItems(t, day, day, today));
      if (day === today) {
        // only the most recent missed occurrence per series needs a decision
        const missed = occurrenceItems(t, addDays(today, -RECURRING_OVERDUE_LOOKBACK), addDays(today, -1), today).filter((i) => i.overdue);
        if (missed.length) overdue.push(missed[missed.length - 1]);
      }
      continue;
    }
    const it = oneOffItem(t, today);
    if (t.status === 'done') {
      if (t.completedAt && t.completedAt >= dayStart && t.completedAt < new Date(dayStart.getTime() + 86400_000)) items.push(it);
      else if (it.date === day) items.push(it);
      continue;
    }
    if (it.overdue && day === today) overdue.push(it);
    else if (it.date === day) items.push(it);
    else if (!it.date) unscheduled.push(it);
    else if (it.date > day && it.date <= addDays(day, 7)) upcoming.push(it);
  }
  const byStart = (a: TaskItem, b: TaskItem) => (a.start ?? '9') < (b.start ?? '9') ? -1 : (a.start ?? '9') > (b.start ?? '9') ? 1 : 0;
  items.sort(byStart);
  upcoming.sort((a, b) => (a.date! < b.date! ? -1 : 1));
  return { today, date: day, items, overdue, unscheduled, upcoming };
}

export async function listTasks(userId: string, filter: { status?: 'open' | 'done'; category?: 'personal' | 'work' }) {
  const s = await getSettings(userId);
  const today = todayIn(s.timezone);
  const tasks = await prisma.task.findMany({
    where: {
      userId,
      status: filter.status === 'done' ? 'done' : 'todo',
      ...(filter.category ? { category: filter.category } : {}),
    },
    include: { recurrence: true, occurrences: true },
    orderBy: [{ dueAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 300,
  });
  return tasks.map((t) => ({ item: oneOffItem(t, today), recurrence: t.recurrence }));
}
