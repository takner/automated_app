'use client';

// Jalali (default) or Gregorian date picker that always emits an ISO local date (or null).
import { useMemo } from 'react';
import {
  GREGORIAN_MONTHS_FA,
  JALALI_MONTHS,
  addDays,
  faDigits,
  formatDate,
  fromCalendar,
  monthLength,
  toCalendar,
  type CalendarKind,
} from '@/lib/dates';

export function DateInput({
  value,
  onChange,
  today,
  calendar = 'jalali',
  allowEmpty = true,
  label,
  shortcuts = true,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  today: string;
  calendar?: CalendarKind;
  allowEmpty?: boolean;
  label?: string;
  shortcuts?: boolean;
}) {
  const base = toCalendar(value ?? today, calendar);
  const years = useMemo(() => {
    const y = toCalendar(today, calendar).y;
    return Array.from({ length: 8 }, (_, i) => y - 2 + i);
  }, [today, calendar]);
  const months = calendar === 'jalali' ? JALALI_MONTHS : GREGORIAN_MONTHS_FA;
  const len = monthLength(calendar, base.y, base.m);

  const set = (y: number, m: number, d: number) => onChange(fromCalendar(calendar, y, m, Math.min(d, monthLength(calendar, y, m))));

  return (
    <div className="space-y-2">
      {label && <span className="label">{label}</span>}
      {shortcuts && (
        <div className="flex flex-wrap gap-2">
          {[
            ['امروز', today],
            ['فردا', addDays(today, 1)],
            ['پس‌فردا', addDays(today, 2)],
            ['هفتهٔ بعد', addDays(today, 7)],
          ].map(([l, d]) => (
            <button key={l} type="button" className={`chip ${value === d ? 'chip-on' : ''}`} onClick={() => onChange(d)}>
              {l}
            </button>
          ))}
          {allowEmpty && value && (
            <button type="button" className="chip text-muted" onClick={() => onChange(null)}>
              بدون تاریخ
            </button>
          )}
        </div>
      )}
      {value || !allowEmpty ? (
        <div className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2">
          <select aria-label="روز" className="field" value={base.d} onChange={(e) => set(base.y, base.m, Number(e.target.value))}>
            {Array.from({ length: len }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                {faDigits(d)}
              </option>
            ))}
          </select>
          <select aria-label="ماه" className="field" value={base.m} onChange={(e) => set(base.y, Number(e.target.value), base.d)}>
            {months.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
          <select aria-label="سال" className="field" value={base.y} onChange={(e) => set(Number(e.target.value), base.m, base.d)}>
            {years.map((y) => (
              <option key={y} value={y}>
                {faDigits(y)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <button type="button" className="chip" onClick={() => onChange(today)}>
          + انتخاب تاریخ
        </button>
      )}
      {value && <p className="text-xs text-muted">{formatDate(value, { weekday: true })}</p>}
    </div>
  );
}

export function TimeInput({ value, onChange, label }: { value: string | null; onChange: (v: string | null) => void; label?: string }) {
  return (
    <label className="block">
      {label && <span className="label">{label}</span>}
      <div className="flex gap-2">
        <input type="time" className="field ltr" value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} step={300} />
        {value && (
          <button type="button" className="btn-ghost shrink-0" onClick={() => onChange(null)}>
            حذف
          </button>
        )}
      </div>
    </label>
  );
}
