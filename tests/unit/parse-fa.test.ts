import { describe, expect, it } from 'vitest';
import { parseFa, numbersToDigits } from '@/lib/capture/parse-fa';
import { resolveDraft } from '@/lib/capture/resolve';
import { toJalali } from '@/lib/dates';

const TZ = 'Asia/Tehran';
// Thursday 16 Mehr 1405, 10:00 Tehran
const NOW = new Date('2026-10-08T06:30:00Z');
const parse = (t: string) => resolveDraft(parseFa(t, { tz: TZ, now: NOW }), { tz: TZ, now: NOW, source: 'rules' });

describe('numbersToDigits', () => {
  it('converts words, compounds and ordinals', () => {
    expect(numbersToDigits('دوازده آبان')).toBe('12 آبان');
    expect(numbersToDigits('بیست و یکم مهر')).toBe('21 مهر');
    expect(numbersToDigits('سوم دی')).toBe('3 دی');
    expect(numbersToDigits('یه هفته قبل')).toBe('1 هفته قبل');
    expect(numbersToDigits('یکشنبه')).toBe('یکشنبه');
  });
});

describe('parseFa', () => {
  it('the car insurance example', () => {
    const d = parse('بیمه ماشین دوازده آبان تموم می‌شه؛ یه هفته قبل و روز قبل یادم بنداز.');
    expect(d.kind).toBe('deadline');
    expect(d.deadlineKind).toBe('insurance');
    expect(d.title).toBe('بیمه ماشین');
    expect(d.date).toEqual({ calendar: 'jalali', year: null, month: 8, day: 12 });
    expect(d.resolvedDate).toBe('2026-11-03');
    expect(d.yearInferred).toBe(true);
    expect(d.dateNote).toContain('۱۴۰۵');
    expect(d.reminderDaysBefore).toEqual([7, 1]);
  });

  it('relative days and ambiguous time asks a question', () => {
    const d = parse('پس‌فردا ساعت ۵ دندانپزشکی');
    expect(d.kind).toBe('task');
    expect(d.resolvedDate).toBe('2026-10-10');
    expect(d.time).toBe('17:00');
    expect(d.questions.find((q) => q.field === 'time')?.options.map((o) => o.value)).toEqual(['05:00', '17:00']);
    expect(d.title).toBe('دندانپزشکی');
  });

  it('explicit period removes ambiguity', () => {
    const d = parse('فردا ساعت ۱۰ صبح جلسه با مشتری، نیم ساعت قبل یادم بنداز');
    expect(d.resolvedDate).toBe('2026-10-09');
    expect(d.time).toBe('10:00');
    expect(d.questions).toHaveLength(0);
    expect(d.category).toBe('work');
    expect(d.reminderMinutesBefore).toEqual([30]);
    expect(d.title).toBe('جلسه با مشتری');
  });

  it('evening and half hours', () => {
    expect(parse('امروز ساعت هشت و نیم شب فیلم').time).toBe('20:30');
    expect(parse('فردا ۱۴:۱۵ تماس با بانک').time).toBe('14:15');
    expect(parse('ساعت ۳ بعدازظهر خرید').time).toBe('15:00');
  });

  it('birthdays keep their jalali month/day', () => {
    const d = parse('تولد سارا ۱۸ مهره');
    expect(d.kind).toBe('birthday');
    expect(d.title).toBe('سارا');
    expect(d.date).toMatchObject({ calendar: 'jalali', month: 7, day: 18 });
    expect(toJalali(d.resolvedDate!)).toEqual({ y: 1405, m: 7, d: 18 });
  });

  it('past date without a year rolls to next year, explicitly', () => {
    const d = parse('سررسید قسط وام ۲ مهر');
    expect(d.kind).toBe('deadline');
    expect(toJalali(d.resolvedDate!)).toEqual({ y: 1406, m: 7, d: 2 });
    expect(d.yearInferred).toBe(true);
  });

  it('recurrence', () => {
    expect(parse('هر روز ساعت ۸ صبح ورزش').recurrence).toEqual({ freq: 'daily', interval: 1, weekdays: [] });
    expect(parse('هر شنبه و دوشنبه کلاس زبان').recurrence).toEqual({ freq: 'weekly', interval: 1, weekdays: [6, 1] });
    expect(parse('هر ماه پرداخت قبض').recurrence?.freq).toBe('monthly');
  });

  it('weekdays and durations', () => {
    const d = parse('شنبه ۴۵ دقیقه گزارش هفتگی بنویسم');
    expect(d.resolvedDate).toBe('2026-10-10');
    expect(d.durationMinutes).toBe(45);
    expect(d.category).toBe('work');
    expect(parse('یک ساعت و نیم مطالعه').durationMinutes).toBe(90);
  });

  it('invalid dates become questions, not silent shifts', () => {
    const d = parse('سررسید اقساط ۳۱ مهر ۱۴۰۵');
    expect(d.resolvedDate).toBeNull();
    expect(d.questions.some((q) => q.field === 'date')).toBe(true);
  });

  it('missing title asks for it', () => {
    expect(parse('فردا ساعت ۱۰ صبح').questions.some((q) => q.field === 'title')).toBe(true);
  });

  it('priority', () => {
    expect(parse('خیلی مهم: تمدید پاسپورت ۱ آذر').priority).toBe('high');
  });
});
