// Recurrence expansion. Rules are evaluated in their own calendar: a monthly Jalali rule on
// the 31st follows Jalali month lengths, a yearly rule on 30 Esfand follows Jalali leap years.
import {
  addDays,
  faDigits,
  diffDays,
  fromCalendar,
  isLeapYear,
  resolveMonthDay,
  startOfWeekSat,
  toCalendar,
  weekday,
  type CalendarKind,
  type LocalDate,
  type MonthEndPolicy,
} from './dates';

export type RecurFreq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface RecurrenceRule {
  freq: RecurFreq;
  interval: number;
  weekdays: number[]; // Luxon weekdays (weekly rules)
  calendar: CalendarKind;
  startDate: LocalDate;
  untilDate?: LocalDate | null;
  monthEndPolicy: MonthEndPolicy;
}

export interface Occurrence {
  date: LocalDate;
  /** true when the nominal day did not exist and the last day of the month was used. */
  adjusted: boolean;
}

const MAX_RESULTS = 2000;

/** All occurrences with from <= date <= to (inclusive), in order. */
export function expandRule(rule: RecurrenceRule, from: LocalDate, to: LocalDate): Occurrence[] {
  const interval = Math.max(1, Math.floor(rule.interval || 1));
  const lo = from > rule.startDate ? from : rule.startDate;
  const hi = rule.untilDate && rule.untilDate < to ? rule.untilDate : to;
  if (lo > hi) return [];
  const out: Occurrence[] = [];
  const push = (o: Occurrence | null) => {
    if (o && o.date >= lo && o.date <= hi && o.date >= rule.startDate) out.push(o);
  };

  switch (rule.freq) {
    case 'daily': {
      const offset = diffDays(lo, rule.startDate);
      const k0 = Math.ceil(offset / interval);
      for (let k = k0; out.length < MAX_RESULTS; k++) {
        const d = addDays(rule.startDate, k * interval);
        if (d > hi) break;
        push({ date: d, adjusted: false });
      }
      break;
    }
    case 'weekly': {
      const days = rule.weekdays.length ? new Set(rule.weekdays) : new Set([weekday(rule.startDate)]);
      const anchorWeek = startOfWeekSat(rule.startDate);
      let week = startOfWeekSat(lo);
      // align to the interval grid
      const weeksFromAnchor = Math.floor(diffDays(week, anchorWeek) / 7);
      const rem = ((weeksFromAnchor % interval) + interval) % interval;
      if (rem) week = addDays(week, (interval - rem) * 7);
      while (week <= hi && out.length < MAX_RESULTS) {
        for (let i = 0; i < 7; i++) {
          const d = addDays(week, i);
          if (days.has(weekday(d))) push({ date: d, adjusted: false });
        }
        week = addDays(week, 7 * interval);
      }
      break;
    }
    case 'monthly': {
      const s = toCalendar(rule.startDate, rule.calendar);
      const l = toCalendar(lo, rule.calendar);
      let idx = (l.y - s.y) * 12 + (l.m - s.m) - 1; // one month of slack before `lo`
      if (idx < 0) idx = 0;
      idx = Math.ceil(idx / interval) * interval;
      for (; out.length < MAX_RESULTS; idx += interval) {
        const total = s.m - 1 + idx;
        const y = s.y + Math.floor(total / 12);
        const m = (total % 12) + 1;
        if (fromCalendar(rule.calendar, y, m, 1) > hi) break;
        push(resolveMonthDay(rule.calendar, y, m, s.d, rule.monthEndPolicy));
      }
      break;
    }
    case 'yearly': {
      const s = toCalendar(rule.startDate, rule.calendar);
      const l = toCalendar(lo, rule.calendar);
      let y = s.y + Math.max(0, Math.ceil((l.y - 1 - s.y) / interval) * interval);
      for (; out.length < MAX_RESULTS; y += interval) {
        if (fromCalendar(rule.calendar, y, 1, 1) > hi) break;
        push(resolveMonthDay(rule.calendar, y, s.m, s.d, rule.monthEndPolicy));
      }
      break;
    }
  }
  return out;
}

/** Dates (within range) of a yearly event given as month/day in a calendar, e.g. birthdays. */
export function yearlyDates(
  calendar: CalendarKind,
  month: number,
  day: number,
  policy: MonthEndPolicy,
  from: LocalDate,
  to: LocalDate,
): Occurrence[] {
  const out: Occurrence[] = [];
  const y0 = toCalendar(from, calendar).y;
  const y1 = toCalendar(to, calendar).y;
  for (let y = y0; y <= y1; y++) {
    const r = resolveMonthDay(calendar, y, month, day, policy);
    if (r && r.date >= from && r.date <= to) out.push(r);
  }
  return out;
}

export function nextYearlyDate(
  calendar: CalendarKind,
  month: number,
  day: number,
  policy: MonthEndPolicy,
  from: LocalDate,
): Occurrence | null {
  // Two years are enough even with `skip` for a leap day… except Jalali leap gaps can be 5 years.
  return yearlyDates(calendar, month, day, policy, from, addDays(from, 366 * 6))[0] ?? null;
}

/** Human description of how a rule treats days that don't exist. */
export function monthEndNote(rule: Pick<RecurrenceRule, 'freq' | 'calendar' | 'startDate' | 'monthEndPolicy'>): string | null {
  const s = toCalendar(rule.startDate, rule.calendar);
  if (rule.freq === 'monthly' && s.d > 28) {
    return rule.monthEndPolicy === 'clamp'
      ? `در ماه‌هایی که روز ${faDigits(s.d)} ندارند، آخرین روز ماه در نظر گرفته می‌شود.`
      : `در ماه‌هایی که روز ${faDigits(s.d)} ندارند، این کار تکرار نمی‌شود.`;
  }
  if (rule.freq === 'yearly') {
    const leapOnly =
      (rule.calendar === 'jalali' && s.m === 12 && s.d === 30) ||
      (rule.calendar === 'gregorian' && s.m === 2 && s.d === 29);
    if (leapOnly) {
      return rule.monthEndPolicy === 'clamp'
        ? 'در سال‌های غیرکبیسه، روز قبل (آخرین روز ماه) در نظر گرفته می‌شود.'
        : 'در سال‌های غیرکبیسه تکرار نمی‌شود.';
    }
  }
  return null;
}

export function isLeapDay(calendar: CalendarKind, month: number, day: number): boolean {
  return (calendar === 'jalali' && month === 12 && day === 30) || (calendar === 'gregorian' && month === 2 && day === 29);
}

export { isLeapYear };
