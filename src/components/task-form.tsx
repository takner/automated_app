'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WEEK_ORDER, WEEKDAYS_FA, faDigits, utcToLocal } from '@/lib/dates';
import { monthEndNote } from '@/lib/recurrence';
import { api } from './client-api';
import { DateInput, TimeInput } from './date-input';
import { TASK_REMINDERS } from './draft-preview';
import { ChipToggle, Segmented, Sheet, Spinner, useToast } from './ui';

type Level = 'low' | 'medium' | 'high';
type Freq = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TaskFormValue {
  id?: string;
  title: string;
  description: string | null;
  category: 'personal' | 'work';
  priority: Level;
  energy: Level | null;
  dueDate: string | null;
  dueTime: string | null;
  scheduledStart: string | null;
  durationMinutes: number | null;
  reminderOffsets: number[];
  reminderAnchor: 'start' | 'due';
  timezone: string;
  status: 'todo' | 'done' | 'cancelled';
  recurrence: {
    freq: Freq;
    interval: number;
    weekdays: number[];
    calendar: 'jalali' | 'gregorian';
    startDate: string;
    untilDate: string | null;
    time: string | null;
    monthEndPolicy: 'clamp' | 'skip';
  } | null;
}

export interface OccurrenceValue {
  date: string;
  title: string | null;
  start: string | null;
  durationMinutes: number | null;
  status: string;
}

export function TaskForm({ task, today, occurrence, calendarLinked }: { task: TaskFormValue; today: string; occurrence?: OccurrenceValue | null; calendarLinked: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const isNew = !task.id;
  const [scope, setScope] = useState<'one' | 'all'>(occurrence ? 'one' : 'all');
  const start = task.scheduledStart ? utcToLocal(new Date(task.scheduledStart), task.timezone) : null;
  const [v, setV] = useState({
    ...task,
    scheduledDate: start?.date ?? null,
    scheduledTime: start?.time ?? null,
  });
  const occStart = occurrence?.start ? utcToLocal(new Date(occurrence.start), task.timezone) : null;
  const [occ, setOcc] = useState({
    title: occurrence?.title ?? task.title,
    date: occStart?.date ?? occurrence?.date ?? today,
    time: occStart?.time ?? task.recurrence?.time ?? null,
    durationMinutes: occurrence?.durationMinutes ?? task.durationMinutes,
  });
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removeEvents, setRemoveEvents] = useState(true);

  const set = <K extends keyof typeof v>(k: K, val: (typeof v)[K]) => setV((x) => ({ ...x, [k]: val }));
  const toggle = (list: number[], x: number) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x]);
  const rec = v.recurrence;
  const note = rec ? monthEndNote({ freq: rec.freq, calendar: rec.calendar, startDate: rec.startDate, monthEndPolicy: rec.monthEndPolicy }) : null;
  const showsMonthPolicy = rec && (rec.freq === 'monthly' || rec.freq === 'yearly');

  async function save() {
    setBusy(true);
    try {
      if (scope === 'one' && occurrence && task.id) {
        await api(`/api/tasks/${task.id}/occurrences/${occurrence.date}`, {
          method: 'PATCH',
          body: { title: occ.title === task.title ? null : occ.title, date: occ.date, time: occ.time, durationMinutes: occ.durationMinutes },
        });
        toast('فقط همین نوبت ذخیره شد');
      } else {
        const body = {
          title: v.title,
          description: v.description || null,
          category: v.category,
          priority: v.priority,
          energy: v.energy,
          durationMinutes: v.durationMinutes,
          reminderOffsets: v.reminderOffsets,
          reminderAnchor: v.reminderAnchor,
          recurrence: rec,
          ...(rec
            ? {}
            : {
                dueDate: v.dueDate,
                dueTime: v.dueDate ? v.dueTime : null,
                scheduledDate: v.scheduledDate && v.scheduledTime ? v.scheduledDate : null,
                scheduledTime: v.scheduledDate && v.scheduledTime ? v.scheduledTime : null,
              }),
        };
        if (isNew) await api('/api/tasks', { body });
        else await api(`/api/tasks/${task.id}`, { method: 'PATCH', body });
        toast(rec && !isNew ? 'کل مجموعه ذخیره شد' : 'ذخیره شد');
      }
      router.push('/tasks');
      router.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/tasks/${task.id}${calendarLinked && removeEvents ? '?removeEvents=1' : ''}`, { method: 'DELETE' });
      toast('حذف شد');
      router.push('/tasks');
      router.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {occurrence && (
        <div className="space-y-2">
          <Segmented
            label="دامنهٔ ویرایش"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'one', label: 'فقط این نوبت' },
              { value: 'all', label: 'کل مجموعهٔ تکرار' },
            ]}
          />
          <p className="text-xs text-muted">
            {scope === 'one' ? 'تغییرات فقط روی نوبت انتخاب‌شده اعمال می‌شود.' : 'تغییرات روی همهٔ نوبت‌ها اعمال می‌شود؛ نوبت‌هایی که جداگانه ویرایش کرده‌اید دست‌نخورده می‌مانند.'}
          </p>
        </div>
      )}

      {scope === 'one' && occurrence ? (
        <div className="space-y-4">
          <label className="block">
            <span className="label">عنوان این نوبت</span>
            <input className="field" value={occ.title} onChange={(e) => setOcc({ ...occ, title: e.target.value })} />
          </label>
          <DateInput label="روز" value={occ.date} onChange={(d) => d && setOcc({ ...occ, date: d })} today={today} allowEmpty={false} />
          <TimeInput label="ساعت" value={occ.time} onChange={(t) => setOcc({ ...occ, time: t })} />
          <DurationInput value={occ.durationMinutes} onChange={(d) => setOcc({ ...occ, durationMinutes: d })} />
        </div>
      ) : (
        <div className="space-y-4">
          <label className="block">
            <span className="label">عنوان</span>
            <input className="field" value={v.title} onChange={(e) => set('title', e.target.value)} maxLength={200} required />
          </label>
          <label className="block">
            <span className="label">توضیح (اختیاری)</span>
            <textarea className="field min-h-20" value={v.description ?? ''} onChange={(e) => set('description', e.target.value)} maxLength={5000} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <span className="label">دسته</span>
              <Segmented value={v.category} onChange={(x) => set('category', x)} options={[{ value: 'personal', label: 'شخصی' }, { value: 'work', label: 'کاری' }]} />
            </div>
            <div>
              <span className="label">اهمیت</span>
              <Segmented value={v.priority} onChange={(x) => set('priority', x)} options={[{ value: 'low', label: 'کم' }, { value: 'medium', label: 'متوسط' }, { value: 'high', label: 'زیاد' }]} />
            </div>
            <div>
              <span className="label">انرژی لازم</span>
              <Segmented
                value={v.energy ?? 'none'}
                onChange={(x) => set('energy', x === 'none' ? null : (x as Level))}
                options={[{ value: 'none', label: '—' }, { value: 'low', label: 'کم' }, { value: 'medium', label: 'متوسط' }, { value: 'high', label: 'زیاد' }]}
              />
            </div>
            <DurationInput value={v.durationMinutes} onChange={(d) => set('durationMinutes', d)} />
          </div>

          <fieldset className="card space-y-3 p-3">
            <legend className="px-1 text-sm font-semibold">تکرار</legend>
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
                <ChipToggle
                  key={l}
                  on={(rec?.freq ?? null) === f}
                  onClick={() =>
                    set(
                      'recurrence',
                      f
                        ? {
                            freq: f,
                            interval: rec?.interval ?? 1,
                            weekdays: rec?.weekdays ?? [],
                            calendar: rec?.calendar ?? 'jalali',
                            startDate: rec?.startDate ?? v.scheduledDate ?? v.dueDate ?? today,
                            untilDate: rec?.untilDate ?? null,
                            time: rec?.time ?? v.scheduledTime ?? null,
                            monthEndPolicy: rec?.monthEndPolicy ?? 'clamp',
                          }
                        : null,
                    )
                  }
                >
                  {l}
                </ChipToggle>
              ))}
            </div>
            {rec && (
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  هر
                  <input
                    className="field ltr w-16 text-center"
                    inputMode="numeric"
                    value={rec.interval}
                    onChange={(e) => set('recurrence', { ...rec, interval: Math.max(1, Math.min(52, Number(e.target.value.replace(/\D/g, '')) || 1)) })}
                  />
                  {{ daily: 'روز', weekly: 'هفته', monthly: 'ماه', yearly: 'سال' }[rec.freq]}
                </label>
                {rec.freq === 'weekly' && (
                  <div className="flex flex-wrap gap-1.5">
                    {WEEK_ORDER.map((d) => (
                      <ChipToggle key={d} on={rec.weekdays.includes(d)} onClick={() => set('recurrence', { ...rec, weekdays: toggle(rec.weekdays, d) })}>
                        {WEEKDAYS_FA[d]}
                      </ChipToggle>
                    ))}
                  </div>
                )}
                {showsMonthPolicy && (
                  <div>
                    <span className="label">تقویم تکرار</span>
                    <Segmented value={rec.calendar} onChange={(c) => set('recurrence', { ...rec, calendar: c })} options={[{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }]} />
                  </div>
                )}
                <DateInput label="شروع" value={rec.startDate} onChange={(d) => d && set('recurrence', { ...rec, startDate: d })} today={today} allowEmpty={false} calendar={rec.calendar} />
                <DateInput label="پایان (اختیاری)" value={rec.untilDate} onChange={(d) => set('recurrence', { ...rec, untilDate: d })} today={today} shortcuts={false} calendar={rec.calendar} />
                <TimeInput label="ساعت هر نوبت (اختیاری)" value={rec.time} onChange={(t) => set('recurrence', { ...rec, time: t })} />
                {showsMonthPolicy && note && (
                  <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
                    <p>{note}</p>
                    <Segmented
                      value={rec.monthEndPolicy}
                      onChange={(p) => set('recurrence', { ...rec, monthEndPolicy: p })}
                      options={[{ value: 'clamp', label: 'آخرین روز ماه' }, { value: 'skip', label: 'آن ماه رد شود' }]}
                    />
                  </div>
                )}
              </div>
            )}
          </fieldset>

          {!rec && (
            <fieldset className="card space-y-3 p-3">
              <legend className="px-1 text-sm font-semibold">زمان‌ها</legend>
              <DateInput label="موعد (تا کی باید انجام شود)" value={v.dueDate} onChange={(d) => set('dueDate', d)} today={today} />
              {v.dueDate && <TimeInput label="ساعت موعد (اختیاری)" value={v.dueTime} onChange={(t) => set('dueTime', t)} />}
              <hr className="border-line" />
              <DateInput label="زمان اجرا (کِی انجامش می‌دهید)" value={v.scheduledDate} onChange={(d) => set('scheduledDate', d)} today={today} />
              {v.scheduledDate && <TimeInput label="ساعت اجرا" value={v.scheduledTime} onChange={(t) => set('scheduledTime', t)} />}
              {v.scheduledDate && !v.scheduledTime && <p className="text-xs text-warn">برای زمان اجرا ساعت هم لازم است؛ بدون ساعت ذخیره نمی‌شود.</p>}
            </fieldset>
          )}

          <fieldset className="card space-y-3 p-3">
            <legend className="px-1 text-sm font-semibold">یادآوری</legend>
            <div className="flex flex-wrap gap-2">
              {TASK_REMINDERS.map((r) => (
                <ChipToggle key={r.v} on={v.reminderOffsets.includes(r.v)} onClick={() => set('reminderOffsets', toggle(v.reminderOffsets, r.v))}>
                  {r.l}
                </ChipToggle>
              ))}
            </div>
            {!rec && v.dueDate && v.scheduledDate && (
              <div>
                <span className="label">نسبت به</span>
                <Segmented value={v.reminderAnchor} onChange={(a) => set('reminderAnchor', a)} options={[{ value: 'start', label: 'زمان اجرا' }, { value: 'due', label: 'موعد' }]} />
              </div>
            )}
          </fieldset>
        </div>
      )}

      <div className="flex gap-2">
        <button className="btn-primary flex-1" onClick={save} disabled={busy}>
          {busy && <Spinner />} ذخیره{occurrence ? (scope === 'one' ? ' (این نوبت)' : ' (کل مجموعه)') : ''}
        </button>
        {!isNew && (
          <button className="btn-danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
            حذف
          </button>
        )}
      </div>

      <Sheet open={confirmDelete} onClose={() => setConfirmDelete(false)} title="حذف کار">
        <div className="space-y-4 text-sm">
          <p>«{task.title}» {rec ? 'و همهٔ نوبت‌هایش ' : ''}حذف می‌شود و یادآوری‌های آن لغو می‌شوند. این کار برگشت‌پذیر نیست.</p>
          {calendarLinked && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={removeEvents} onChange={(e) => setRemoveEvents(e.target.checked)} className="size-4" />
              رویدادهایی که هم‌روز برای این کار در Google Calendar ساخته هم حذف شوند
            </label>
          )}
          <div className="flex gap-2">
            <button className="btn-danger flex-1" onClick={remove} disabled={busy}>
              {busy && <Spinner />} حذف شود
            </button>
            <button className="btn-ghost" onClick={() => setConfirmDelete(false)}>
              انصراف
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function DurationInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div>
      <span className="label">مدت تخمینی</span>
      <div className="flex flex-wrap gap-1.5">
        {[15, 30, 45, 60, 90, 120].map((m) => (
          <ChipToggle key={m} on={value === m} onClick={() => onChange(value === m ? null : m)}>
            {m < 60 ? `${faDigits(m)}د` : `${faDigits(m / 60)}س`}
          </ChipToggle>
        ))}
        <input
          aria-label="مدت به دقیقه"
          className="field ltr w-20 py-1.5 text-center"
          inputMode="numeric"
          placeholder="دقیقه"
          value={value && ![15, 30, 45, 60, 90, 120].includes(value) ? value : ''}
          onChange={(e) => onChange(e.target.value ? Math.max(1, Math.min(1440, Number(e.target.value.replace(/\D/g, '')) || 0)) || null : null)}
        />
      </div>
    </div>
  );
}
