// Birthdays and deadlines (insurance and other renewals).
import { z } from 'zod';
import { prisma } from '../db';
import { HttpError, notFound } from '../errors';
import { diffDays, isLocalDate, isValidCalendarDate, toCalendar, todayIn, type LocalDate } from '../dates';
import { isLeapDay, nextYearlyDate } from '../recurrence';
import { cancelSource, syncBirthdayNotifications, syncDeadlineNotifications } from '../notifications/sync';
import { getSettings } from './settings';

const localDate = z.string().refine(isLocalDate, 'تاریخ نامعتبر');
const days = z.array(z.number().int().min(0).max(365)).max(10);

export const birthdayInput = z
  .object({
    name: z.string().trim().min(1, 'نام لازم است').max(120),
    calendar: z.enum(['jalali', 'gregorian']).default('jalali'),
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    year: z.number().int().min(1200).max(2200).nullish(),
    reminderDays: days.default([0, 3]),
    notes: z.string().max(2000).nullish(),
    leapPolicy: z.enum(['clamp', 'skip']).default('clamp'),
  })
  .refine(
    (b) => {
      // validate against a leap year so 30 Esfand / 29 Feb are accepted, then against the birth year
      const probe = b.calendar === 'jalali' ? 1403 : 2024;
      if (!isValidCalendarDate(b.calendar, probe, b.month, b.day)) return false;
      return b.year == null || isValidCalendarDate(b.calendar, b.year, b.month, b.day);
    },
    { message: 'این روز در این ماه وجود ندارد', path: ['day'] },
  );

const deadlineBase = z.object({
  title: z.string().trim().min(1, 'عنوان لازم است').max(200),
  kind: z.enum(['insurance', 'other']),
  dueDate: localDate,
  notes: z.string().max(2000).nullish(),
  reminderDays: days,
});
export const deadlineInput = deadlineBase.extend({
  kind: deadlineBase.shape.kind.default('other'),
  reminderDays: days.default([30, 7, 1]),
});

export const renewInput = z.object({ newDueDate: localDate, note: z.string().max(500).nullish() });

export async function createBirthday(userId: string, raw: unknown) {
  const b = birthdayInput.parse(raw);
  const row = await prisma.birthday.create({
    data: { userId, ...b, year: b.year ?? null, notes: b.notes ?? null, reminderDays: [...new Set(b.reminderDays)].sort((x, y) => y - x) },
  });
  await syncBirthdayNotifications(row.id);
  return row;
}

export async function updateBirthday(userId: string, id: string, raw: unknown) {
  const existing = await prisma.birthday.findFirst({ where: { id, userId } });
  if (!existing) throw notFound();
  const b = birthdayInput.parse({ ...existing, ...(raw as object) });
  const row = await prisma.birthday.update({
    where: { id },
    data: { ...b, year: b.year ?? null, notes: b.notes ?? null, reminderDays: [...new Set(b.reminderDays)].sort((x, y) => y - x) },
  });
  await syncBirthdayNotifications(id);
  return row;
}

export async function deleteBirthday(userId: string, id: string) {
  const existing = await prisma.birthday.findFirst({ where: { id, userId } });
  if (!existing) throw notFound();
  await cancelSource(userId, 'birthday', id);
  await prisma.birthday.delete({ where: { id } });
}

export async function createDeadline(userId: string, raw: unknown) {
  const d = deadlineInput.parse(raw);
  const row = await prisma.deadline.create({
    data: { userId, ...d, notes: d.notes ?? null, reminderDays: [...new Set(d.reminderDays)].sort((x, y) => y - x) },
  });
  await syncDeadlineNotifications(row.id);
  return row;
}

export async function updateDeadline(userId: string, id: string, raw: unknown) {
  const existing = await prisma.deadline.findFirst({ where: { id, userId } });
  if (!existing) throw notFound();
  const patch = deadlineBase.partial().extend({ archived: z.boolean().optional() }).parse(raw);
  const row = await prisma.deadline.update({
    where: { id },
    data: {
      ...patch,
      notes: patch.notes === undefined ? undefined : (patch.notes ?? null),
      reminderDays: patch.reminderDays ? [...new Set(patch.reminderDays)].sort((x, y) => y - x) : undefined,
    },
  });
  await syncDeadlineNotifications(id);
  return row;
}

/** «تمدید شد»: record history, move to the new due date, reschedule reminders. */
export async function renewDeadline(userId: string, id: string, raw: unknown) {
  const { newDueDate, note } = renewInput.parse(raw);
  const existing = await prisma.deadline.findFirst({ where: { id, userId } });
  if (!existing) throw notFound();
  if (newDueDate <= existing.dueDate) throw new HttpError(400, 'تاریخ جدید باید بعد از سررسید فعلی باشد');
  const row = await prisma.$transaction(async (tx) => {
    await tx.deadlineRenewal.create({ data: { deadlineId: id, previousDueDate: existing.dueDate, newDueDate, note: note ?? null } });
    return tx.deadline.update({ where: { id }, data: { dueDate: newDueDate, archived: false } });
  });
  await syncDeadlineNotifications(id);
  return row;
}

export async function deleteDeadline(userId: string, id: string) {
  const existing = await prisma.deadline.findFirst({ where: { id, userId } });
  if (!existing) throw notFound();
  await cancelSource(userId, 'deadline', id);
  await prisma.deadline.delete({ where: { id } });
}

export interface BirthdayView {
  id: string;
  name: string;
  calendar: 'jalali' | 'gregorian';
  month: number;
  day: number;
  year: number | null;
  notes: string | null;
  reminderDays: number[];
  leapPolicy: 'clamp' | 'skip';
  next: LocalDate | null;
  nextAdjusted: boolean;
  daysUntil: number | null;
  turning: number | null;
  leapDay: boolean;
}

export async function listDates(userId: string) {
  const s = await getSettings(userId);
  const today = todayIn(s.timezone);
  const [birthdays, deadlines] = await Promise.all([
    prisma.birthday.findMany({ where: { userId } }),
    prisma.deadline.findMany({ where: { userId }, include: { renewals: { orderBy: { renewedAt: 'desc' } } }, orderBy: { dueDate: 'asc' } }),
  ]);
  const bViews: BirthdayView[] = birthdays
    .map((b) => {
      const next = nextYearlyDate(b.calendar, b.month, b.day, b.leapPolicy, today);
      const turning = next && b.year ? toCalendar(next.date, b.calendar).y - b.year : null;
      return {
        id: b.id, name: b.name, calendar: b.calendar, month: b.month, day: b.day, year: b.year, notes: b.notes,
        reminderDays: b.reminderDays, leapPolicy: b.leapPolicy,
        next: next?.date ?? null, nextAdjusted: next?.adjusted ?? false,
        daysUntil: next ? diffDays(next.date, today) : null,
        turning, leapDay: isLeapDay(b.calendar, b.month, b.day),
      };
    })
    .sort((a, b) => (a.daysUntil ?? 9999) - (b.daysUntil ?? 9999));
  const dViews = deadlines.map((d) => ({ ...d, daysUntil: diffDays(d.dueDate, today) }));
  return { today, birthdays: bViews, deadlines: dViews };
}
