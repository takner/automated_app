// Deterministic Persian (colloquial + formal) parser for quick capture.
// Understands: امروز/فردا/پس‌فردا, «N روز دیگه», weekdays, «دوازده آبان», 1405/8/12, times with
// صبح/ظهر/عصر/شب, «یه هفته قبل»-style reminders, «هر روز/هر شنبه» recurrences, durations,
// and recognises birthdays and expiry/renewal deadlines. Ambiguities become questions.
import {
  JALALI_MONTHS,
  GREGORIAN_MONTHS_FA,
  WEEKDAYS_FA,
  addDays,
  latinDigits,
  todayIn,
  toJalali,
  fromJalali,
  weekday,
  faDigits,
} from '../dates';
import type { CaptureDraft } from './schema';

const L = '\\p{L}';
const B = `(?<![${L}\\d])`; // word start
const E = `(?![${L}\\d])`; // word end
const S = '[\\s\\u200c]*'; // optional space / ZWNJ
const S1 = '[\\s\\u200c]+';

const UNITS: Record<string, number> = {
  یک: 1, یه: 1, دو: 2, سه: 3, چهار: 4, پنج: 5, شش: 6, شیش: 6, هفت: 7, هشت: 8, نه: 9,
};
const TEENS: Record<string, number> = {
  ده: 10, یازده: 11, دوازده: 12, سیزده: 13, چهارده: 14, پانزده: 15, پونزده: 15, شانزده: 16,
  شونزده: 16, هفده: 17, هیفده: 17, هجده: 18, هیجده: 18, نوزده: 19,
};
const TENS: Record<string, number> = { بیست: 20, سی: 30, چهل: 40, پنجاه: 50, شصت: 60 };
const ORDINAL_SPECIAL: Record<string, number> = { اول: 1, یکم: 1, دوم: 2, سوم: 3 };

function wordToNumber(w: string): number | null {
  if (w in UNITS) return UNITS[w];
  if (w in TEENS) return TEENS[w];
  if (w in TENS) return TENS[w];
  return null;
}

const NUM_WORD = [...Object.keys(TEENS), ...Object.keys(TENS), ...Object.keys(UNITS)]
  .sort((a, b) => b.length - a.length)
  .join('|');

/** Replace spelled-out numbers (incl. «بیست و یک», ordinals «دوازدهم», «سی‌ام») with digits. */
export function numbersToDigits(text: string): string {
  // compounds: «بیست و یک», «سی و یکم»
  const compound = new RegExp(
    `${B}(${Object.keys(TENS).join('|')})${S1}و${S1}(${Object.keys(UNITS).join('|')})(م|ام|ُم)?${E}`,
    'gu',
  );
  let t = text.replace(compound, (_, tens: string, unit: string) => String(TENS[tens] + UNITS[unit]));
  t = t.replace(new RegExp(`${B}(اول|یکم|دوم|سوم)${E}`, 'gu'), (_, w: string) => String(ORDINAL_SPECIAL[w]));
  // ordinal suffixes: دوازدهم، چهارم، بیستم، سی‌ام
  t = t.replace(new RegExp(`${B}(${NUM_WORD})${S}(م|ام|ُم)${E}`, 'gu'), (m, w: string) => {
    const n = wordToNumber(w);
    return n == null ? m : String(n);
  });
  t = t.replace(new RegExp(`${B}(${NUM_WORD})${E}`, 'gu'), (m, w: string, offset: number, whole: string) => {
    // «نه» is also "no"; only treat it as 9 next to a unit/month/time word
    if (w === 'نه') {
      const after = whole.slice(offset + m.length, offset + m.length + 12);
      if (!/^[\s‌]*(روز|ساعت|دقیقه|هفته|ماه|صبح|شب|عصر|و|فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند)/u.test(after)) return m;
    }
    const n = wordToNumber(w);
    return n == null ? m : String(n);
  });
  // digits with ordinal suffix: «12م» / «12 ام»
  t = t.replace(/(\d+)[\s‌]*(ام|م)(?![\p{L}])/gu, '$1');
  return t;
}

export function normalize(text: string): string {
  return numbersToDigits(
    latinDigits(text)
      .replace(/[يى]/g, 'ی')
      .replace(/ك/g, 'ک')
      .replace(/[ًٌٍَُِّ]/g, '')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

interface Ctx {
  text: string;
}

function take(ctx: Ctx, re: RegExp): RegExpExecArray | null {
  const m = re.exec(ctx.text);
  if (!m) return null;
  ctx.text = ctx.text.slice(0, m.index) + ' ' + ctx.text.slice(m.index + m[0].length);
  return m;
}

function takeAll(ctx: Ctx, re: RegExp): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = take(ctx, re))) out.push(m);
  return out;
}

const JM = JALALI_MONTHS.map((m) => m).join('|');
const GM = [...GREGORIAN_MONTHS_FA, 'می', 'جولای', 'آگوست', 'اگوست', 'ژوئیه'].join('|');
const GM_INDEX: Record<string, number> = Object.fromEntries(GREGORIAN_MONTHS_FA.map((m, i) => [m, i + 1]));
Object.assign(GM_INDEX, { می: 5, جولای: 7, آگوست: 8, اگوست: 8 });

const WEEKDAY_WORDS: Array<[string, number]> = [
  ['سه شنبه', 2], ['سه‌شنبه', 2], ['سهشنبه', 2],
  ['چهارشنبه', 3], ['چهار شنبه', 3], ['چارشنبه', 3],
  ['پنجشنبه', 4], ['پنج شنبه', 4], ['پنج‌شنبه', 4],
  ['یکشنبه', 7], ['یک شنبه', 7], ['یک‌شنبه', 7],
  ['دوشنبه', 1], ['دو شنبه', 1], ['دو‌شنبه', 1],
  ['جمعه', 5], ['شنبه', 6],
];
// numbersToDigits turns «سه شنبه» into «3 شنبه»; accept those forms too.
const WD_RE_SRC = WEEKDAY_WORDS.map(([w]) => w.replace(/ /g, S))
  .concat(['1' + S + 'شنبه', '2' + S + 'شنبه', '3' + S + 'شنبه', '4' + S + 'شنبه', '5' + S + 'شنبه'])
  .join('|');
function weekdayFromWord(w: string): number | null {
  const compact = w.replace(/[\s‌]/g, '');
  const digit = /^(\d)شنبه$/.exec(compact);
  if (digit) return ({ 1: 7, 2: 1, 3: 2, 4: 3, 5: 4 } as Record<string, number>)[digit[1]] ?? null;
  for (const [word, n] of WEEKDAY_WORDS) if (word.replace(/[\s‌]/g, '') === compact) return n;
  return null;
}

const WORK_WORDS = /(جلسه|مشتری|پروژه|گزارش|شرکت|ایمیل|ارائه|پروپوزال|دفتر|همکار|مدیر|رئیس|فاکتور|قرارداد|کارفرما|اداره|سمینار|دیپلوی|کد|تسک)/u;
const DEADLINE_WORDS = /(بیمه|تمدید|سررسید|سر[\s‌]*رسید|انقضا|منقضی|تموم[\s‌]*می[\s‌]*ش|تمام[\s‌]*می[\s‌]*شود|قسط|اقساط|معاینه[\s‌]*فنی|گواهینامه|پاسپورت|گذرنامه|اشتراک|عوارض)/u;

export interface ParseOptions {
  now?: Date;
  tz: string;
}

export function parseFa(input: string, opts: ParseOptions): CaptureDraft {
  const now = opts.now ?? new Date();
  const today = todayIn(opts.tz, now);
  const ctx: Ctx = { text: ` ${normalize(input)} ` };
  const questions: CaptureDraft['questions'] = [];

  // ── kind ──
  const isBirthday = /تولد/u.test(ctx.text);
  const isDeadline = !isBirthday && DEADLINE_WORDS.test(ctx.text);
  const kind: CaptureDraft['kind'] = isBirthday ? 'birthday' : isDeadline ? 'deadline' : 'task';

  // ── reminders («یه هفته قبل», «روز قبل», «نیم ساعت قبل», «همون روز») ──
  const minutesBefore: number[] = [];
  const unitMin: Record<string, number> = { دقیقه: 1, ساعت: 60, روز: 1440, هفته: 10080, ماه: 43200 };
  for (const m of takeAll(
    ctx,
    new RegExp(`${B}(?:(\\d+|نیم)${S})?(دقیقه|ساعت|روز|هفته|ماه)${S}(?:قبلش|قبل|پیشش|پیش|زودتر)${E}`, 'u'),
  )) {
    const n = m[1] === 'نیم' ? 0.5 : m[1] ? Number(m[1]) : 1;
    minutesBefore.push(Math.round(n * unitMin[m[2]]));
  }
  if (take(ctx, new RegExp(`${B}(همون|همان)${S1}روز${E}|${B}روز${S1}خودش${E}`, 'u'))) minutesBefore.push(0);
  // «و» left between reminders, e.g. «یه هفته قبل و روز قبل»
  ctx.text = ctx.text.replace(/(^|\s)و(?=\s+(یادم|بهم|یادآوری))/gu, ' ');

  // ── recurrence ──
  let recurrence: CaptureDraft['recurrence'] = null;
  let m: RegExpExecArray | null;
  if ((m = take(ctx, new RegExp(`${B}هر${S1}(?:(\\d+)${S1})?(روز|هفته|ماه|سال)${E}`, 'u')))) {
    const freq = ({ روز: 'daily', هفته: 'weekly', ماه: 'monthly', سال: 'yearly' } as const)[m[2] as 'روز'];
    recurrence = { freq, interval: m[1] ? Number(m[1]) : 1, weekdays: [] };
  } else if ((m = take(ctx, new RegExp(`${B}هر${S1}(${WD_RE_SRC})(?:${S1}و${S1}(${WD_RE_SRC}))*${E}`, 'u')))) {
    const days = [...m[0].matchAll(new RegExp(WD_RE_SRC, 'gu'))].map((x) => weekdayFromWord(x[0])).filter((x): x is number => x != null);
    recurrence = { freq: 'weekly', interval: 1, weekdays: [...new Set(days)] };
  }
  // Adjectives like «گزارش هفتگی» or «ورزش روزانه» are usually part of the title, so only
  // «هر …» phrases create a recurrence; the preview lets the user add one otherwise.

  // ── date ──
  let date: CaptureDraft['date'] = null;
  const jalToday = toJalali(today);
  const setFromIso = (iso: string) => {
    const j = toJalali(iso);
    date = { calendar: 'jalali', year: j.y, month: j.m, day: j.d };
  };
  if ((m = take(ctx, /(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})/u))) {
    const y = Number(m[1]);
    date = { calendar: y > 1700 ? 'gregorian' : 'jalali', year: y, month: Number(m[2]), day: Number(m[3]) };
  } else if ((m = take(ctx, new RegExp(`${B}(\\d{1,2})${S}(?:ام|م)?${S}(${JM})(?:ه|ِ|ی)?(?:${S1}(?:سال${S1})?(\\d{4}))?${E}`, 'u')))) {
    date = { calendar: 'jalali', year: m[3] ? Number(m[3]) : null, month: JALALI_MONTHS.indexOf(m[2]) + 1, day: Number(m[1]) };
  } else if ((m = take(ctx, new RegExp(`${B}(\\d{1,2})${S}(${GM})(?:ه|ِ)?(?:${S1}(\\d{4}))?${E}`, 'u')))) {
    date = { calendar: 'gregorian', year: m[3] ? Number(m[3]) : null, month: GM_INDEX[m[2]], day: Number(m[1]) };
  } else if (take(ctx, new RegExp(`${B}پس${S}فردا${E}`, 'u'))) {
    setFromIso(addDays(today, 2));
  } else if (take(ctx, new RegExp(`${B}فردا(?:ش)?${E}`, 'u'))) {
    setFromIso(addDays(today, 1));
  } else if (take(ctx, new RegExp(`${B}(امروز|امشب)${E}`, 'u'))) {
    setFromIso(today);
  } else if ((m = take(ctx, new RegExp(`${B}(\\d+)${S1}(روز|هفته|ماه)${S1}(?:دیگه|دیگر|بعد)${E}`, 'u')))) {
    const n = Number(m[1]);
    if (m[2] === 'روز') setFromIso(addDays(today, n));
    else if (m[2] === 'هفته') setFromIso(addDays(today, 7 * n));
    else {
      const total = jalToday.m - 1 + n;
      const y = jalToday.y + Math.floor(total / 12);
      const mo = (total % 12) + 1;
      date = { calendar: 'jalali', year: y, month: mo, day: jalToday.d };
    }
  } else if (take(ctx, new RegExp(`${B}هفته${S1}(?:بعد|دیگه|دیگر|آینده)${E}`, 'u'))) {
    setFromIso(addDays(today, 7));
  } else if (take(ctx, new RegExp(`${B}ماه${S1}(?:بعد|دیگه|دیگر|آینده)${E}`, 'u'))) {
    const y = jalToday.m === 12 ? jalToday.y + 1 : jalToday.y;
    date = { calendar: 'jalali', year: y, month: (jalToday.m % 12) + 1, day: jalToday.d };
  } else if (!recurrence && (m = take(ctx, new RegExp(`${B}(این${S1})?(${WD_RE_SRC})(?:${S1}(بعد|آینده|دیگه))?${E}`, 'u')))) {
    const wd = weekdayFromWord(m[2]);
    if (wd != null) {
      let delta = (wd - weekday(today) + 7) % 7;
      if (delta === 0 && !m[1]) delta = 7;
      setFromIso(addDays(today, delta));
    }
  } else if ((m = take(ctx, new RegExp(`${B}(\\d{1,2})${S}(?:ام|م)?${S1}(?:این${S1})?ماه${E}`, 'u')))) {
    date = { calendar: 'jalali', year: jalToday.y, month: jalToday.m, day: Number(m[1]) };
  }

  // ── time ──
  let time: string | null = null;
  const timeRe = new RegExp(
      `${B}(?:ساعت${S})?(\\d{1,2})(?::(\\d{2}))?(?:${S1}و${S1}(نیم|ربع|(\\d{1,2})${S1}دقیقه))?(?:${S1}(صبح|ظهر|بعد${S}از${S}ظهر|بعدازظهر|عصر|شب|بامداد))?${E}`,
      'gu',
    );
  // a bare number is only a time with «ساعت», a colon or a period word (صبح/عصر/…)
  const tm = [...ctx.text.matchAll(timeRe)].find((x) => /ساعت/u.test(x[0]) || x[2] != null || !!x[5]) ?? null;
  let timeMatched = false;
  if (tm) {
    ctx.text = ctx.text.slice(0, tm.index) + ' ' + ctx.text.slice(tm.index! + tm[0].length);
    const hadSaat = /ساعت/u.test(tm[0]);
    const hasPeriod = !!tm[5];
    const hasColon = tm[2] != null;
    if (hadSaat || hasPeriod || hasColon) {
      timeMatched = true;
      let h = Number(tm[1]);
      let min = tm[2] ? Number(tm[2]) : tm[3] === 'نیم' ? 30 : tm[3] === 'ربع' ? 15 : tm[4] ? Number(tm[4]) : 0;
      const period = tm[5]?.replace(/[\s‌]/g, '');
      if (h > 24 || min > 59) {
        timeMatched = false;
      } else {
        if (h === 24) h = 0;
        if (period) {
          if (period === 'صبح' || period === 'بامداد') h = h === 12 ? 0 : h;
          else if (period === 'ظهر') h = h >= 1 && h <= 4 ? h + 12 : h;
          else if (period === 'بعدازظهر' || period === 'عصر') h = h < 12 ? h + 12 : h;
          else if (period === 'شب') h = h === 12 ? 0 : h >= 5 && h < 12 ? h + 12 : h;
        } else if (h >= 1 && h <= 12) {
          // genuinely ambiguous: choose a sensible default and ask
          const am = h >= 7 && h <= 11;
          const pmH = h === 12 ? 12 : h + 12;
          const amH = h === 12 ? 0 : h;
          const chosen = h === 12 ? 12 : am ? amH : pmH;
          questions.push({
            field: 'time',
            text: `ساعت ${faDigits(h)}${min ? `:${faDigits(String(min).padStart(2, '0'))}` : ''} صبح است یا بعدازظهر؟`,
            options: [
              { label: h === 12 ? '۱۲ ظهر' : `${faDigits(h)} صبح`, value: `${String(h === 12 ? 12 : amH).padStart(2, '0')}:${String(min).padStart(2, '0')}` },
              { label: h === 12 ? '۱۲ شب' : `${faDigits(h)} بعدازظهر`, value: `${String(h === 12 ? 0 : pmH).padStart(2, '0')}:${String(min).padStart(2, '0')}` },
            ],
          });
          h = chosen;
        }
        time = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
    }
    if (!timeMatched) {
      // out of range (e.g. «ساعت ۳۰»): put it back where it was
      ctx.text = ctx.text.slice(0, tm.index) + tm[0] + ctx.text.slice(tm.index! + 1);
    }
  }
  if (!time && take(ctx, new RegExp(`${B}ظهر${E}`, 'u'))) time = '12:00';

  // ── duration («نیم ساعت», «۴۵ دقیقه», «یک ساعت و نیم») ──
  let durationMinutes: number | null = null;
  if ((m = take(ctx, new RegExp(`${B}(\\d+|نیم)${S}(ساعت|دقیقه)(?:${S1}و${S1}نیم)?(?:${S1}(?:طول|وقت)${S}(?:می${S}کشه|میکشه|می‌گیره|لازم))?${E}`, 'u')))) {
    const n = m[1] === 'نیم' ? 0.5 : Number(m[1]);
    durationMinutes = Math.round(m[2] === 'ساعت' ? n * 60 + (/و\s*نیم/u.test(m[0]) ? 30 : 0) : n);
  }

  // ── priority / category ──
  let priority: CaptureDraft['priority'] = 'medium';
  if (take(ctx, new RegExp(`${B}(خیلی${S1})?(مهم|فوری|ضروری)(ه|است)?${E}`, 'u'))) priority = 'high';
  else if (take(ctx, new RegExp(`${B}(اگه|اگر)${S1}وقت${S1}(شد|کردم)${E}`, 'u'))) priority = 'low';
  const category: CaptureDraft['category'] = WORK_WORDS.test(ctx.text) ? 'work' : 'personal';

  // ── title ──
  let title = ctx.text
    .replace(new RegExp(`(به${S})?(من${S1})?(یادم|بهم|منو)${S1}(بنداز|بیار|بندازی|یادآوری${S}کن)`, 'gu'), ' ')
    .replace(new RegExp(`${B}(یادم${S1}باشه|یادآوری${S}کن|یادآوری|لطفا|لطفاً|باید|حتما|حتماً|که)${E}`, 'gu'), ' ')
    .replace(new RegExp(`(تموم|تمام)${S}(می${S}شه|میشه|می${S}شود|میشود|می${S}شن)`, 'gu'), ' ')
    .replace(new RegExp(`${B}(سررسید|سر${S1}رسید|انقضا|منقضی)${S}(ش|اش)?${S}(هست|است|ه)?${E}`, 'gu'), ' ')
    .replace(/[؛;،,.!؟?:]+/gu, ' ')
    .replace(new RegExp(`(^|\\s)(و|ساعت|روز|تا|در|برای|به)(?=\\s*$)`, 'gu'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // trailing conjunction/preposition after removals
  title = title.replace(/(\s(و|در|برای|تا|به|از|ساعت))+$/u, '').replace(/^((و|که|در)\s)+/u, '').trim();

  if (kind === 'birthday') {
    title = title.replace(new RegExp(`${B}(روز${S1})?تولد(ِ|ه|ش)?${E}`, 'gu'), ' ').replace(/\s+/g, ' ').trim();
    title = title.replace(/(ه|است|هست)$/u, '').trim();
    if (!title) questions.push({ field: 'title', text: 'تولد چه کسی است؟', options: [] });
  } else if (!title) {
    questions.push({ field: 'title', text: 'عنوان را بنویسید.', options: [] });
  }

  if ((kind === 'birthday' || kind === 'deadline') && !date) {
    questions.push({ field: 'date', text: kind === 'birthday' ? 'تاریخ تولد چه روزی است؟' : 'تاریخ سررسید چه روزی است؟', options: [] });
  }

  const reminderDaysBefore =
    kind === 'task' ? [] : [...new Set(minutesBefore.map((x) => Math.round(x / 1440)))].sort((a, b) => b - a);
  const reminderMinutesBefore = kind === 'task' ? [...new Set(minutesBefore)].sort((a, b) => b - a) : [];

  return {
    kind,
    title: title.slice(0, 200),
    category,
    priority,
    date,
    time: kind === 'task' ? time : null,
    durationMinutes: kind === 'task' ? durationMinutes : null,
    reminderMinutesBefore,
    reminderDaysBefore,
    recurrence: kind === 'task' ? recurrence : null,
    deadlineKind: kind === 'deadline' && /بیمه/u.test(input) ? 'insurance' : 'other',
    questions,
  };
}

export { WEEKDAYS_FA, fromJalali };
