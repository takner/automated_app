'use client';

// Editable preview of a capture draft. Nothing is stored until «ثبت» is pressed.
import { useState } from 'react';
import type { ResolvedDraft } from '@/lib/capture/schema';
import { WEEK_ORDER, WEEKDAYS_FA, faDigits, toCalendar, type CalendarKind } from '@/lib/dates';
import { api } from './client-api';
import { DateInput, TimeInput } from './date-input';
import { ChipToggle, Segmented, Spinner, useToast } from './ui';

export const TASK_REMINDERS = [
  { v: 0, l: 'سر وقت' },
  { v: 10, l: '۱۰ دقیقه قبل' },
  { v: 30, l: '۳۰ دقیقه قبل' },
  { v: 60, l: '۱ ساعت قبل' },
  { v: 1440, l: '۱ روز قبل' },
];
export const DAY_REMINDERS = [
  { v: 0, l: 'همان روز' },
  { v: 1, l: '۱ روز قبل' },
  { v: 3, l: '۳ روز قبل' },
  { v: 7, l: '۱ هفته قبل' },
  { v: 14, l: '۲ هفته قبل' },
  { v: 30, l: '۱ ماه قبل' },
];

function labelMinutes(m: number) {
  const known = TASK_REMINDERS.find((r) => r.v === m);
  if (known) return known.l;
  if (m % 1440 === 0) return `${faDigits(m / 1440)} روز قبل`;
  if (m % 60 === 0) return `${faDigits(m / 60)} ساعت قبل`;
  return `${faDigits(m)} دقیقه قبل`;
}

export function DraftPreview({ draft, today, onSaved, onCancel }: { draft: ResolvedDraft; today: string; onSaved: () => void; onCancel: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState(draft.kind);
  const [title, setTitle] = useState(draft.title);
  const [category, setCategory] = useState(draft.category);
  const [priority, setPriority] = useState(draft.priority);
  const [date, setDate] = useState<string | null>(draft.resolvedDate);
  const [time, setTime] = useState<string | null>(draft.time);
  const [duration, setDuration] = useState<number | null>(draft.durationMinutes);
  const [minBefore, setMinBefore] = useState<number[]>(draft.reminderMinutesBefore);
  const [daysBefore, setDaysBefore] = useState<number[]>(
    draft.reminderDaysBefore.length ? draft.reminderDaysBefore : draft.kind === 'birthday' ? [0, 3] : draft.kind === 'deadline' ? [30, 7, 1] : [],
  );
  const [recurrence, setRecurrence] = useState(draft.recurrence);
  const [deadlineKind, setDeadlineKind] = useState(draft.deadlineKind);
  const birthdayCalendar: CalendarKind = draft.date?.calendar ?? 'jalali';
  const [answered, setAnswered] = useState<Record<number, boolean>>({});
  const [busy, setBusy] = useState(false);

  const toggle = (list: number[], v: number) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const allMinutes = [...new Set([...TASK_REMINDERS.map((r) => r.v), ...minBefore])].sort((a, b) => a - b);

  async function save() {
    if (!title.trim()) return toast('عنوان را وارد کنید', 'error');
    setBusy(true);
    try {
      if (kind === 'task') {
        const body: Record<string, unknown> = { title, category, priority, durationMinutes: duration, reminderOffsets: minBefore };
        if (recurrence) body.recurrence = { ...recurrence, calendar: 'jalali', startDate: date ?? today, time };
        else if (date && time) Object.assign(body, { scheduledDate: date, scheduledTime: time });
        else if (date) body.dueDate = date;
        if (!recurrence && minBefore.length && !date) return toast('برای یادآوری، تاریخ را مشخص کنید', 'error');
        await api('/api/tasks', { body });
      } else if (kind === 'birthday') {
        if (!date) return toast('تاریخ تولد را مشخص کنید', 'error');
        const c = toCalendar(date, birthdayCalendar);
        await api('/api/birthdays', { body: { name: title, calendar: birthdayCalendar, month: c.m, day: c.d, year: draft.date?.year ?? null, reminderDays: daysBefore } });
      } else {
        if (!date) return toast('تاریخ سررسید را مشخص کنید', 'error');
        await api('/api/deadlines', { body: { title, kind: deadlineKind, dueDate: date, reminderDays: daysBefore } });
      }
      toast('ثبت شد');
      onSaved();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {draft.transcript && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <span className="text-muted">متن شنیده‌شده: </span>
          {draft.transcript}
        </div>
      )}
      {draft.questions.map((q, i) =>
        answered[i] ? null : (
          <div key={i} className="rounded-xl border border-warn/40 bg-warn-soft p-3 text-sm">
            <p className="font-medium">{q.text}</p>
            {q.options.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {q.options.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    className={`chip ${q.field === 'time' && time === o.value ? 'chip-on' : ''}`}
                    onClick={() => {
                      if (q.field === 'time') setTime(o.value);
                      setAnswered((a) => ({ ...a, [i]: true }));
                    }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ),
      )}

      <Segmented
        label="نوع"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'task', label: 'کار' },
          { value: 'deadline', label: 'سررسید' },
          { value: 'birthday', label: 'تولد' },
        ]}
      />

      <label className="block">
        <span className="label">{kind === 'birthday' ? 'نام' : 'عنوان'}</span>
        <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>

      <div>
        <DateInput
          label={kind === 'birthday' ? `تاریخ تولد (${birthdayCalendar === 'jalali' ? 'شمسی' : 'میلادی'})` : kind === 'deadline' ? 'تاریخ سررسید' : recurrence ? 'شروع تکرار' : 'تاریخ'}
          value={date}
          onChange={setDate}
          today={today}
          calendar={kind === 'birthday' ? birthdayCalendar : 'jalali'}
          allowEmpty={kind === 'task'}
          shortcuts={kind !== 'birthday'}
        />
        {draft.dateNote && date === draft.resolvedDate && <p className="mt-1 text-xs text-warn">{draft.dateNote}</p>}
      </div>

      {kind === 'task' && (
        <>
          <TimeInput label="ساعت (اختیاری)" value={time} onChange={setTime} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <span className="label">دسته</span>
              <Segmented value={category} onChange={setCategory} options={[{ value: 'personal', label: 'شخصی' }, { value: 'work', label: 'کاری' }]} />
            </div>
            <div>
              <span className="label">اهمیت</span>
              <Segmented value={priority} onChange={setPriority} options={[{ value: 'low', label: 'کم' }, { value: 'medium', label: 'متوسط' }, { value: 'high', label: 'زیاد' }]} />
            </div>
          </div>
          <label className="block">
            <span className="label">مدت تخمینی (دقیقه، اختیاری)</span>
            <input
              className="field ltr text-right"
              inputMode="numeric"
              value={duration ?? ''}
              onChange={(e) => setDuration(e.target.value ? Math.max(1, Math.min(1440, Number(e.target.value.replace(/\D/g, '')) || 0)) || null : null)}
              placeholder="مثلاً ۳۰"
            />
          </label>
          <div>
            <span className="label">یادآوری</span>
            <div className="flex flex-wrap gap-2">
              {allMinutes.map((v) => (
                <ChipToggle key={v} on={minBefore.includes(v)} onClick={() => setMinBefore(toggle(minBefore, v))}>
                  {labelMinutes(v)}
                </ChipToggle>
              ))}
            </div>
            {minBefore.length > 0 && !time && !recurrence && <p className="mt-1 text-xs text-muted">بدون ساعت، یادآوری نسبت به ساعت یادآوری روزانه (تنظیمات) حساب می‌شود.</p>}
          </div>
          <div>
            <span className="label">تکرار</span>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  [null, 'بدون تکرار'],
                  ['daily', 'روزانه'],
                  ['weekly', 'هفتگی'],
                  ['monthly', 'ماهانه'],
                  ['yearly', 'سالانه'],
                ] as const
              ).map(([f, l]) => (
                <ChipToggle key={l} on={(recurrence?.freq ?? null) === f} onClick={() => setRecurrence(f ? { freq: f, interval: 1, weekdays: recurrence?.weekdays ?? [] } : null)}>
                  {l}
                </ChipToggle>
              ))}
            </div>
            {recurrence?.freq === 'weekly' && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {WEEK_ORDER.map((d) => (
                  <ChipToggle key={d} on={recurrence.weekdays.includes(d)} onClick={() => setRecurrence({ ...recurrence, weekdays: toggle(recurrence.weekdays, d) })}>
                    {WEEKDAYS_FA[d]}
                  </ChipToggle>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {kind !== 'task' && (
        <div>
          {kind === 'deadline' && (
            <div className="mb-3">
              <span className="label">نوع سررسید</span>
              <Segmented value={deadlineKind} onChange={setDeadlineKind} options={[{ value: 'insurance', label: 'بیمه' }, { value: 'other', label: 'سایر' }]} />
            </div>
          )}
          <span className="label">یادآوری</span>
          <div className="flex flex-wrap gap-2">
            {DAY_REMINDERS.map((r) => (
              <ChipToggle key={r.v} on={daysBefore.includes(r.v)} onClick={() => setDaysBefore(toggle(daysBefore, r.v))}>
                {r.l}
              </ChipToggle>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>
          {busy && <Spinner />} ثبت
        </button>
        <button className="btn-ghost" onClick={onCancel} disabled={busy}>
          انصراف
        </button>
      </div>
      <p className="text-center text-xs text-muted">{draft.source === 'ai' ? 'برداشت با کمک هوش مصنوعی؛ قبل از ثبت بررسی کنید.' : 'برداشت خودکار از متن؛ قبل از ثبت بررسی کنید.'}</p>
    </div>
  );
}
