import { describe, expect, it } from 'vitest';
import {
  addDays, formatDate, fromJalali, isLeapYear, monthLength, resolveMonthDay, toJalali,
  todayIn, utcToLocal, zonedToUtc, faDigits, latinDigits, startOfWeekSat, weekday,
} from '@/lib/dates';

describe('jalali conversion', () => {
  it('round-trips known dates', () => {
    expect(toJalali('2026-03-21')).toEqual({ y: 1405, m: 1, d: 1 }); // Nowruz 1405
    expect(fromJalali(1405, 8, 12)).toBe('2026-11-03');
    expect(toJalali('2026-10-08')).toEqual({ y: 1405, m: 7, d: 16 });
  });
  it('handles year boundary (Esfand → Farvardin)', () => {
    const lastDay = fromJalali(1404, 12, monthLength('jalali', 1404, 12));
    expect(toJalali(addDays(lastDay, 1))).toEqual({ y: 1405, m: 1, d: 1 });
  });
  it('knows jalali leap years and month lengths', () => {
    expect(isLeapYear('jalali', 1403)).toBe(true);
    expect(isLeapYear('jalali', 1404)).toBe(false);
    expect(monthLength('jalali', 1403, 12)).toBe(30);
    expect(monthLength('jalali', 1404, 12)).toBe(29);
    expect(monthLength('jalali', 1405, 7)).toBe(30);
    expect(monthLength('jalali', 1405, 6)).toBe(31);
  });
  it('resolves non-existent days by explicit policy', () => {
    expect(resolveMonthDay('jalali', 1405, 7, 31, 'clamp')).toEqual({ date: fromJalali(1405, 7, 30), adjusted: true });
    expect(resolveMonthDay('jalali', 1405, 7, 31, 'skip')).toBeNull();
    expect(resolveMonthDay('jalali', 1404, 12, 30, 'clamp')?.adjusted).toBe(true);
    expect(resolveMonthDay('gregorian', 2027, 2, 29, 'clamp')).toEqual({ date: '2027-02-28', adjusted: true });
  });
});

describe('time zones (Asia/Tehran)', () => {
  it('converts local wall time to UTC (+03:30, no DST)', () => {
    expect(zonedToUtc('2026-10-08', '09:00', 'Asia/Tehran').toISOString()).toBe('2026-10-08T05:30:00.000Z');
    expect(zonedToUtc('2026-06-01', '09:00', 'Asia/Tehran').toISOString()).toBe('2026-06-01T05:30:00.000Z');
  });
  it('computes "today" in the user zone, not UTC', () => {
    // 22:00 UTC is already 01:30 next day in Tehran
    const now = new Date('2026-10-08T22:00:00Z');
    expect(todayIn('Asia/Tehran', now)).toBe('2026-10-09');
    expect(todayIn('UTC', now)).toBe('2026-10-08');
    expect(utcToLocal(now, 'Asia/Tehran')).toEqual({ date: '2026-10-09', time: '01:30' });
  });
});

describe('formatting', () => {
  it('formats in persian', () => {
    expect(formatDate('2026-11-03')).toBe('۱۲ آبان ۱۴۰۵');
    expect(formatDate('2026-11-03', { weekday: true, year: false })).toBe('سه‌شنبه ۱۲ آبان');
    expect(faDigits('12:30')).toBe('۱۲:۳۰');
    expect(latinDigits('۱۴۰۵/۰۸/۱۲')).toBe('1405/08/12');
  });
  it('weeks start on Saturday', () => {
    expect(weekday('2026-10-10')).toBe(6);
    expect(startOfWeekSat('2026-10-08')).toBe('2026-10-03');
    expect(startOfWeekSat('2026-10-10')).toBe('2026-10-10');
  });
});
