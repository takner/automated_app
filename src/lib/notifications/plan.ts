// Pure computation of which reminders *should* exist for a source right now.
// The sync step (sync.ts) diffs this against the queue. Keeping it pure makes the
// "cancel on edit/complete/delete" behaviour easy to test.
import {
  addDays,
  faDigits,
  formatDate,
  todayIn,
  utcToLocal,
  zonedToUtc,
  type LocalDate,
} from '../dates';
import { expandRule, nextYearlyDate, yearlyDates, type RecurrenceRule } from '../recurrence';

export interface DesiredNotification {
  dedupeKey: string;
  fireAt: Date;
  title: string;
  body: string;
  url: string;
}

export interface TaskLike {
  id: string;
  title: string;
  status: 'todo' | 'done' | 'cancelled';
  dueDate: string | null;
  dueTime: string | null;
  dueAt: Date | null;
  scheduledStart: Date | null;
  reminderOffsets: number[];
  reminderAnchor: 'start' | 'due';
  timezone: string;
}

export interface OccurrenceRow {
  date: string;
  status: 'todo' | 'done' | 'skipped';
  overrideTitle: string | null;
  overrideStart: Date | null;
  movedToDate: string | null;
}

export interface RuleLike extends RecurrenceRule {
  time: string | null;
}

const RECURRING_HORIZON_DAYS = 14;
const GRACE_MS = 60_000;

function offsetLabel(min: number): string {
  if (min === 0) return 'الان';
  if (min % 10080 === 0) return `${faDigits(min / 10080)} هفته دیگر`;
  if (min % 1440 === 0) return min === 1440 ? 'فردا' : `${faDigits(min / 1440)} روز دیگر`;
  if (min % 60 === 0) return `${faDigits(min / 60)} ساعت دیگر`;
  return `${faDigits(min)} دقیقه دیگر`;
}

function taskBody(anchor: Date, offset: number, tz: string, kind: 'start' | 'due', dateOnly: boolean): string {
  const l = utcToLocal(anchor, tz);
  const when = dateOnly ? formatDate(l.date, { weekday: true, year: false }) : `ساعت ${faDigits(l.time)}`;
  const prefix = kind === 'due' ? 'موعد' : 'زمان انجام';
  return offset === 0 ? `${prefix}: ${when}` : `${prefix}: ${when} (${offsetLabel(offset)})`;
}

export function desiredForTask(
  task: TaskLike,
  rule: RuleLike | null,
  occurrences: OccurrenceRow[],
  opts: { now: Date; dateReminderTime: string },
): DesiredNotification[] {
  if (task.status !== 'todo' || task.reminderOffsets.length === 0) return [];
  const tz = task.timezone;
  const out: DesiredNotification[] = [];
  const add = (anchor: Date, occ: string, title: string, kind: 'start' | 'due', dateOnly: boolean) => {
    for (const offset of task.reminderOffsets) {
      const fireAt = new Date(anchor.getTime() - offset * 60_000);
      if (fireAt.getTime() < opts.now.getTime() - GRACE_MS) continue;
      out.push({
        dedupeKey: `task:${task.id}:${occ}:${anchor.toISOString()}:${offset}`,
        fireAt,
        title,
        body: taskBody(anchor, offset, tz, kind, dateOnly),
        url: `/tasks/${task.id}${occ ? `?occ=${occ}` : ''}`,
      });
    }
  };

  if (!rule) {
    let anchor: Date | null = null;
    let kind: 'start' | 'due' = task.reminderAnchor;
    let dateOnly = false;
    if (kind === 'start') anchor = task.scheduledStart;
    if (!anchor && task.dueDate) {
      kind = 'due';
      dateOnly = !task.dueTime;
      anchor = task.dueTime ? zonedToUtc(task.dueDate, task.dueTime, tz) : zonedToUtc(task.dueDate, opts.dateReminderTime, tz);
    }
    if (!anchor && task.scheduledStart) {
      kind = 'start';
      anchor = task.scheduledStart;
    }
    if (anchor) add(anchor, '', task.title, kind, dateOnly);
    return out;
  }

  const today = todayIn(tz, opts.now);
  const horizon = addDays(today, RECURRING_HORIZON_DAYS);
  const rows = new Map(occurrences.map((o) => [o.date, o]));
  const dates = new Set(expandRule(rule, addDays(today, -1), horizon).map((o) => o.date));
  for (const o of occurrences) if (o.movedToDate) dates.add(o.date);
  for (const d of [...dates].sort()) {
    const row = rows.get(d);
    if (row && row.status !== 'todo') continue;
    const effectiveDate: LocalDate = row?.movedToDate ?? d;
    let anchor: Date;
    let dateOnly = false;
    if (row?.overrideStart) anchor = row.overrideStart;
    else if (rule.time) anchor = zonedToUtc(effectiveDate, rule.time, tz);
    else {
      anchor = zonedToUtc(effectiveDate, opts.dateReminderTime, tz);
      dateOnly = true;
    }
    add(anchor, d, row?.overrideTitle ?? task.title, 'start', dateOnly);
  }
  return out;
}

export interface BirthdayLike {
  id: string;
  name: string;
  calendar: 'jalali' | 'gregorian';
  month: number;
  day: number;
  year: number | null;
  reminderDays: number[];
  notes: string | null;
  leapPolicy: 'clamp' | 'skip';
}

export function desiredForBirthday(
  b: BirthdayLike,
  opts: { now: Date; tz: string; dateReminderTime: string },
): DesiredNotification[] {
  const today = todayIn(opts.tz, opts.now);
  const maxLead = Math.max(0, ...b.reminderDays);
  // occurrences whose reminder window is not over yet: from today up to a year + lead ahead
  const occs = yearlyDates(b.calendar, b.month, b.day, b.leapPolicy, today, addDays(today, 366 + maxLead));
  const out: DesiredNotification[] = [];
  for (const occ of occs.slice(0, 2)) {
    for (const days of b.reminderDays) {
      const fireAt = zonedToUtc(addDays(occ.date, -days), opts.dateReminderTime, opts.tz);
      if (fireAt.getTime() < opts.now.getTime() - GRACE_MS) continue;
      const when = days === 0 ? 'امروز' : days === 1 ? 'فردا' : `${faDigits(days)} روز دیگر`;
      let body = `${when} تولد ${b.name} است (${formatDate(occ.date, { calendar: b.calendar, year: false })}).`;
      if (b.notes && days > 0) body += ` یادداشت: ${b.notes.slice(0, 80)}`;
      out.push({
        dedupeKey: `birthday:${b.id}:${occ.date}:${days}`,
        fireAt,
        title: days === 0 ? `🎂 تولد ${b.name}` : `تولد ${b.name} نزدیک است`,
        body,
        url: `/dates?b=${b.id}`,
      });
    }
  }
  return out;
}

export interface DeadlineLike {
  id: string;
  title: string;
  dueDate: string;
  reminderDays: number[];
  archived: boolean;
}

export function desiredForDeadline(
  d: DeadlineLike,
  opts: { now: Date; tz: string; dateReminderTime: string },
): DesiredNotification[] {
  if (d.archived) return [];
  const out: DesiredNotification[] = [];
  for (const days of d.reminderDays) {
    const fireAt = zonedToUtc(addDays(d.dueDate, -days), opts.dateReminderTime, opts.tz);
    if (fireAt.getTime() < opts.now.getTime() - GRACE_MS) continue;
    const when = days === 0 ? 'امروز' : days === 1 ? 'فردا' : `${faDigits(days)} روز دیگر`;
    out.push({
      dedupeKey: `deadline:${d.id}:${d.dueDate}:${days}`,
      fireAt,
      title: `سررسید: ${d.title}`,
      body: `${when} (${formatDate(d.dueDate, { weekday: true })}) سررسید ${d.title} است.`,
      url: `/dates?d=${d.id}`,
    });
  }
  return out;
}

export { nextYearlyDate };
