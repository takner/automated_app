// Turns a draft's calendar date into a concrete local date. This always runs on the server,
// so the model never decides what "12 Aban" means without a year.
import {
  JALALI_MONTHS,
  GREGORIAN_MONTHS_FA,
  faDigits,
  fromCalendar,
  isValidCalendarDate,
  toCalendar,
  todayIn,
} from '../dates';
import { nextYearlyDate } from '../recurrence';
import type { CaptureDraft, ResolvedDraft } from './schema';

export function resolveDraft(
  draft: CaptureDraft,
  opts: { tz: string; now?: Date; source: 'rules' | 'ai'; transcript?: string },
): ResolvedDraft {
  const today = todayIn(opts.tz, opts.now);
  const questions = [...draft.questions];
  let resolvedDate: string | null = null;
  let yearInferred = false;
  let dateNote: string | null = null;
  const d = draft.date;

  if (d) {
    const monthName = (d.calendar === 'jalali' ? JALALI_MONTHS : GREGORIAN_MONTHS_FA)[d.month - 1];
    if (draft.kind === 'birthday') {
      const next = nextYearlyDate(d.calendar, d.month, d.day, 'clamp', today);
      const probeYear = d.year ?? toCalendar(today, d.calendar).y;
      if (d.day > 31 || (d.year != null && !isValidCalendarDate(d.calendar, d.year, d.month, d.day))) {
        questions.push({ field: 'date', text: `${monthName} ${faDigits(probeYear)} روز ${faDigits(d.day)} ندارد.`, options: [] });
      } else if (next) {
        resolvedDate = next.date;
        if (next.adjusted) dateNote = 'امسال این روز در تقویم نیست؛ آخرین روز ماه در نظر گرفته می‌شود.';
      }
    } else if (d.year != null) {
      if (isValidCalendarDate(d.calendar, d.year, d.month, d.day)) resolvedDate = fromCalendar(d.calendar, d.year, d.month, d.day);
      else questions.push({ field: 'date', text: `${monthName} ${faDigits(d.year)} روز ${faDigits(d.day)} ندارد. تاریخ را اصلاح کنید.`, options: [] });
    } else {
      // no year given: the next time this date comes around
      const thisYear = toCalendar(today, d.calendar).y;
      for (const y of [thisYear, thisYear + 1]) {
        if (!isValidCalendarDate(d.calendar, y, d.month, d.day)) continue;
        const iso = fromCalendar(d.calendar, y, d.month, d.day);
        if (iso >= today) {
          resolvedDate = iso;
          yearInferred = true;
          dateNote = `سال گفته نشده بود؛ ${faDigits(y)} در نظر گرفته شد.`;
          break;
        }
      }
      if (!resolvedDate) questions.push({ field: 'date', text: `${monthName} روز ${faDigits(d.day)} ندارد. تاریخ را اصلاح کنید.`, options: [] });
    }
  }

  return { ...draft, questions, resolvedDate, yearInferred, dateNote, source: opts.source, transcript: opts.transcript };
}
