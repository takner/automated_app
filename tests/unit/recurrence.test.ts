import { describe, expect, it } from 'vitest';
import { expandRule, yearlyDates, nextYearlyDate, monthEndNote } from '@/lib/recurrence';
import { fromJalali, toJalali } from '@/lib/dates';

const base = { interval: 1, weekdays: [], calendar: 'jalali' as const, monthEndPolicy: 'clamp' as const };

describe('expandRule', () => {
  it('daily with interval', () => {
    const r = expandRule({ ...base, freq: 'daily', interval: 2, startDate: '2026-10-01' }, '2026-10-04', '2026-10-10');
    expect(r.map((o) => o.date)).toEqual(['2026-10-05', '2026-10-07', '2026-10-09']);
  });
  it('weekly on chosen weekdays', () => {
    // Sat (6) and Mon (1)
    const r = expandRule({ ...base, freq: 'weekly', weekdays: [6, 1], startDate: '2026-10-01' }, '2026-10-03', '2026-10-12');
    expect(r.map((o) => o.date)).toEqual(['2026-10-03', '2026-10-05', '2026-10-10', '2026-10-12']);
  });
  it('bi-weekly stays on the anchor grid', () => {
    const r = expandRule({ ...base, freq: 'weekly', interval: 2, weekdays: [6], startDate: '2026-10-03' }, '2026-10-01', '2026-11-01');
    expect(r.map((o) => o.date)).toEqual(['2026-10-03', '2026-10-17', '2026-10-31']);
  });
  it('monthly on jalali 31st clamps to 30 in second half of the year', () => {
    const start = fromJalali(1405, 6, 31);
    const r = expandRule({ ...base, freq: 'monthly', startDate: start }, start, fromJalali(1405, 9, 30));
    expect(r.map((o) => toJalali(o.date))).toEqual([
      { y: 1405, m: 6, d: 31 }, { y: 1405, m: 7, d: 30 }, { y: 1405, m: 8, d: 30 }, { y: 1405, m: 9, d: 30 },
    ]);
    expect(r.map((o) => o.adjusted)).toEqual([false, true, true, true]);
  });
  it('monthly skip policy drops missing days', () => {
    const start = fromJalali(1405, 6, 31);
    const r = expandRule({ ...base, freq: 'monthly', monthEndPolicy: 'skip', startDate: start }, start, fromJalali(1406, 1, 31));
    expect(r.map((o) => toJalali(o.date))).toEqual([{ y: 1405, m: 6, d: 31 }, { y: 1406, m: 1, d: 31 }]);
  });
  it('monthly in jalali is not a gregorian monthly rule', () => {
    const start = fromJalali(1405, 7, 1); // 23 Sep 2026
    const r = expandRule({ ...base, freq: 'monthly', startDate: start }, start, fromJalali(1405, 9, 1));
    expect(r.map((o) => o.date)).toEqual(['2026-09-23', '2026-10-23', '2026-11-22']);
  });
  it('yearly crosses the jalali year boundary', () => {
    const start = fromJalali(1404, 12, 25);
    const r = expandRule({ ...base, freq: 'yearly', startDate: start }, '2026-01-01', '2028-12-31');
    expect(r.map((o) => toJalali(o.date))).toEqual([
      { y: 1404, m: 12, d: 25 }, { y: 1405, m: 12, d: 25 }, { y: 1406, m: 12, d: 25 },
    ]);
  });
  it('respects untilDate and startDate', () => {
    const r = expandRule({ ...base, freq: 'daily', startDate: '2026-10-05', untilDate: '2026-10-07' }, '2026-10-01', '2026-10-30');
    expect(r.map((o) => o.date)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
});

describe('birthdays (yearlyDates)', () => {
  it('a jalali birthday follows the jalali calendar, not a fixed gregorian date', () => {
    const r = yearlyDates('jalali', 1, 1, 'clamp', '2025-01-01', '2028-12-31');
    // Nowruz moves between 20 and 21 March
    expect(r.map((o) => o.date)).toEqual(['2025-03-21', '2026-03-21', '2027-03-21', '2028-03-20']);
  });
  it('30 Esfand birthday clamps in common years and is exact in leap years', () => {
    const r = yearlyDates('jalali', 12, 30, 'clamp', fromJalali(1403, 1, 1), fromJalali(1405, 12, 29));
    expect(r.map((o) => [toJalali(o.date), o.adjusted])).toEqual([
      [{ y: 1403, m: 12, d: 30 }, false],
      [{ y: 1404, m: 12, d: 29 }, true],
      [{ y: 1405, m: 12, d: 29 }, true],
    ]);
  });
  it('gregorian Feb 29 with skip policy', () => {
    expect(nextYearlyDate('gregorian', 2, 29, 'skip', '2026-10-08')?.date).toBe('2028-02-29');
  });
  it('explains month-end policy', () => {
    expect(monthEndNote({ freq: 'monthly', calendar: 'jalali', startDate: fromJalali(1405, 6, 31), monthEndPolicy: 'clamp' })).toContain('آخرین روز ماه');
    expect(monthEndNote({ freq: 'monthly', calendar: 'jalali', startDate: fromJalali(1405, 6, 10), monthEndPolicy: 'clamp' })).toBeNull();
  });
});
