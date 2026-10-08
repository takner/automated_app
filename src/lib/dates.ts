// Calendar and time helpers.
//
// A "LocalDate" is a civil date written as a Gregorian ISO string ("2026-11-03"). It carries no
// time or zone. Which calendar a *rule* follows (Jalali or Gregorian) is stored separately; the
// ISO form is only the canonical spelling of a day, so comparisons and storage stay simple.
import { DateTime } from 'luxon';
import { toJalaali, toGregorian, jalaaliMonthLength, isLeapJalaaliYear } from 'jalaali-js';

export type LocalDate = string;
export type CalendarKind = 'jalali' | 'gregorian';
export type MonthEndPolicy = 'clamp' | 'skip';

export const DEFAULT_TZ = 'Asia/Tehran';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isLocalDate(s: unknown): s is LocalDate {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return false;
  return DateTime.fromISO(s, { zone: 'UTC' }).isValid;
}

export function isTimeOfDay(s: unknown): s is string {
  return typeof s === 'string' && TIME_RE.test(s);
}

function parts(d: LocalDate): [number, number, number] {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`invalid local date: ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function isoFrom(y: number, m: number, d: number): LocalDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function toJalali(d: LocalDate): { y: number; m: number; d: number } {
  const [gy, gm, gd] = parts(d);
  const j = toJalaali(gy, gm, gd);
  return { y: j.jy, m: j.jm, d: j.jd };
}

export function fromJalali(jy: number, jm: number, jd: number): LocalDate {
  const g = toGregorian(jy, jm, jd);
  return isoFrom(g.gy, g.gm, g.gd);
}

export function toCalendar(d: LocalDate, cal: CalendarKind): { y: number; m: number; d: number } {
  if (cal === 'jalali') return toJalali(d);
  const [y, m, dd] = parts(d);
  return { y, m, d: dd };
}

export function fromCalendar(cal: CalendarKind, y: number, m: number, d: number): LocalDate {
  return cal === 'jalali' ? fromJalali(y, m, d) : isoFrom(y, m, d);
}

export function monthLength(cal: CalendarKind, y: number, m: number): number {
  if (cal === 'jalali') return jalaaliMonthLength(y, m);
  return DateTime.utc(y, m, 1).daysInMonth!;
}

export function isLeapYear(cal: CalendarKind, y: number): boolean {
  if (cal === 'jalali') return isLeapJalaaliYear(y);
  return DateTime.utc(y, 1, 1).isInLeapYear;
}

export function isValidCalendarDate(cal: CalendarKind, y: number, m: number, d: number): boolean {
  return Number.isInteger(y) && m >= 1 && m <= 12 && d >= 1 && d <= monthLength(cal, y, m);
}

/**
 * Resolve "day N of month M/Y" when the month may be shorter than N.
 * Returns null when the policy is `skip` and the day does not exist; `adjusted` tells the UI
 * that the date was moved so it can say so instead of shifting silently.
 */
export function resolveMonthDay(
  cal: CalendarKind,
  y: number,
  m: number,
  day: number,
  policy: MonthEndPolicy,
): { date: LocalDate; adjusted: boolean } | null {
  const len = monthLength(cal, y, m);
  if (day <= len) return { date: fromCalendar(cal, y, m, day), adjusted: false };
  if (policy === 'skip') return null;
  return { date: fromCalendar(cal, y, m, len), adjusted: true };
}

export function addDays(d: LocalDate, n: number): LocalDate {
  return DateTime.fromISO(d, { zone: 'UTC' }).plus({ days: n }).toISODate()!;
}

export function diffDays(a: LocalDate, b: LocalDate): number {
  // a - b in whole days
  const da = DateTime.fromISO(a, { zone: 'UTC' });
  const db = DateTime.fromISO(b, { zone: 'UTC' });
  return Math.round(da.diff(db, 'days').days);
}

/** Luxon weekday: 1=Mon … 6=Sat, 7=Sun. */
export function weekday(d: LocalDate): number {
  return DateTime.fromISO(d, { zone: 'UTC' }).weekday;
}

/** Start of the Iranian week (Saturday) containing d. */
export function startOfWeekSat(d: LocalDate): LocalDate {
  const wd = weekday(d); // Sat=6
  const back = (wd - 6 + 7) % 7;
  return addDays(d, -back);
}

export function todayIn(tz: string, now: Date = new Date()): LocalDate {
  return DateTime.fromJSDate(now, { zone: tz }).toISODate()!;
}

/** Wall-clock time in tz → UTC instant. Non-existent local times move forward (Luxon default). */
export function zonedToUtc(date: LocalDate, time: string, tz: string): Date {
  const [y, m, d] = parts(date);
  const [hh, mm] = time.split(':').map(Number);
  const dt = DateTime.fromObject({ year: y, month: m, day: d, hour: hh, minute: mm }, { zone: tz });
  if (!dt.isValid) throw new Error(`invalid zoned time ${date} ${time} ${tz}`);
  return dt.toJSDate();
}

export function utcToLocal(instant: Date, tz: string): { date: LocalDate; time: string } {
  const dt = DateTime.fromJSDate(instant, { zone: tz });
  return { date: dt.toISODate()!, time: dt.toFormat('HH:mm') };
}

/** UTC instant of local midnight starting `date` in tz. */
export function startOfLocalDay(date: LocalDate, tz: string): Date {
  return zonedToUtc(date, '00:00', tz);
}

export function minutesOfDay(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function timeFromMinutes(total: number): string {
  const t = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

// ───────────── Persian display ─────────────

export const JALALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export const GREGORIAN_MONTHS_FA = [
  'ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
  'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر',
];

/** Indexed by Luxon weekday (1=Mon). */
export const WEEKDAYS_FA: Record<number, string> = {
  6: 'شنبه', 7: 'یکشنبه', 1: 'دوشنبه', 2: 'سه‌شنبه', 3: 'چهارشنبه', 4: 'پنجشنبه', 5: 'جمعه',
};

/** Saturday-first order for pickers. */
export const WEEK_ORDER = [6, 7, 1, 2, 3, 4, 5];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export function faDigits(input: string | number): string {
  return String(input).replace(/\d/g, (c) => FA_DIGITS[Number(c)]);
}

export function latinDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (c) => String(FA_DIGITS.indexOf(c)))
    .replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
}

export function formatDate(
  d: LocalDate,
  opts: { calendar?: CalendarKind; weekday?: boolean; year?: boolean } = {},
): string {
  const cal = opts.calendar ?? 'jalali';
  const c = toCalendar(d, cal);
  const month = cal === 'jalali' ? JALALI_MONTHS[c.m - 1] : GREGORIAN_MONTHS_FA[c.m - 1];
  let s = `${faDigits(c.d)} ${month}`;
  if (opts.year !== false) s += ` ${faDigits(c.y)}`;
  if (opts.weekday) s = `${WEEKDAYS_FA[weekday(d)]} ${s}`;
  return s;
}

export function formatTime(time: string): string {
  return faDigits(time);
}

export function formatInstant(instant: Date, tz: string, opts: { date?: boolean } = {}): string {
  const l = utcToLocal(instant, tz);
  return opts.date ? `${formatDate(l.date, { year: false })}، ${faDigits(l.time)}` : faDigits(l.time);
}

export function formatMinutes(min: number): string {
  if (min < 60) return `${faDigits(min)} دقیقه`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${faDigits(h)} ساعت و ${faDigits(m)} دقیقه` : `${faDigits(h)} ساعت`;
}

/** "امروز" / "فردا" / "۳ روز دیگر" / "۲ روز پیش" relative to today. */
export function relativeDay(d: LocalDate, today: LocalDate): string {
  const n = diffDays(d, today);
  if (n === 0) return 'امروز';
  if (n === 1) return 'فردا';
  if (n === 2) return 'پس‌فردا';
  if (n === -1) return 'دیروز';
  return n > 0 ? `${faDigits(n)} روز دیگر` : `${faDigits(-n)} روز پیش`;
}
