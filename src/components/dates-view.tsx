'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BirthdayView } from '@/lib/services/dates-service';
import {
  GREGORIAN_MONTHS_FA,
  JALALI_MONTHS,
  addDays,
  faDigits,
  formatDate,
  fromJalali,
  monthLength,
  relativeDay,
  toCalendar,
  type CalendarKind,
} from '@/lib/dates';
import { api } from './client-api';
import { DateInput } from './date-input';
import { DAY_REMINDERS } from './draft-preview';
import { ChipToggle, Empty, Segmented, Sheet, Spinner, useToast } from './ui';

export interface DeadlineView {
  id: string;
  title: string;
  kind: string;
  dueDate: string;
  notes: string | null;
  reminderDays: number[];
  archived: boolean;
  daysUntil: number;
  renewals: Array<{ id: string; previousDueDate: string; newDueDate: string; note: string | null; renewedAt: string }>;
}

const reminderText = (days: number[]) =>
  days.length ? days.map((d) => (d === 0 ? 'همان روز' : `${faDigits(d)} روز قبل`)).join('، ') : 'بدون یادآوری';

export function DatesView({ today, birthdays, deadlines }: { today: string; birthdays: BirthdayView[]; deadlines: DeadlineView[] }) {
  const [editB, setEditB] = useState<BirthdayView | 'new' | null>(null);
  const [editD, setEditD] = useState<DeadlineView | 'new' | null>(null);
  const [renew, setRenew] = useState<DeadlineView | null>(null);
  const active = deadlines.filter((d) => !d.archived);
  const archived = deadlines.filter((d) => d.archived);

  return (
    <div className="space-y-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-2xl font-bold">سررسیدها</h1>
          <button className="btn-ghost" onClick={() => setEditD('new')}>+ سررسید</button>
        </div>
        {active.length ? (
          <ul className="space-y-2">
            {active.map((d) => (
              <li key={d.id} id={`d-${d.id}`} className="card space-y-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{d.kind === 'insurance' ? '🛡 ' : '⏳ '}{d.title}</p>
                    <p className="text-sm text-muted">{formatDate(d.dueDate, { weekday: true })}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs ${d.daysUntil < 0 ? 'bg-danger-soft text-danger' : d.daysUntil <= 7 ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted'}`}>
                    {d.daysUntil < 0 ? `${faDigits(-d.daysUntil)} روز گذشته` : relativeDay(d.dueDate, today)}
                  </span>
                </div>
                <p className="text-xs text-muted">🔔 {reminderText(d.reminderDays)}</p>
                {d.notes && <p className="text-sm">{d.notes}</p>}
                <div className="flex flex-wrap gap-2">
                  <button className="chip chip-on" onClick={() => setRenew(d)}>✓ تمدید شد</button>
                  <button className="chip" onClick={() => setEditD(d)}>ویرایش</button>
                </div>
                {d.renewals.length > 0 && (
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">سابقهٔ تمدید ({faDigits(d.renewals.length)})</summary>
                    <ul className="mt-1 space-y-0.5">
                      {d.renewals.map((r) => (
                        <li key={r.id}>
                          {formatDate(r.previousDueDate)} ← {formatDate(r.newDueDate)}
                          {r.note ? ` — ${r.note}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <Empty>سررسیدی ثبت نشده. مثلاً بیمهٔ ماشین، گواهینامه یا قسط.</Empty>
        )}
        {archived.length > 0 && (
          <details className="mt-3 text-sm text-muted">
            <summary className="cursor-pointer">بایگانی ({faDigits(archived.length)})</summary>
            <ul className="mt-2 space-y-1">
              {archived.map((d) => (
                <li key={d.id}>
                  <button className="underline" onClick={() => setEditD(d)}>{d.title}</button> — {formatDate(d.dueDate)}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-2xl font-bold">تولدها</h2>
          <button className="btn-ghost" onClick={() => setEditB('new')}>+ تولد</button>
        </div>
        {birthdays.length ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {birthdays.map((b) => (
              <li key={b.id} id={`b-${b.id}`}>
                <button className="card block w-full p-3 text-right" onClick={() => setEditB(b)}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">🎂 {b.name}{b.turning ? <span className="text-sm font-normal text-muted"> · {faDigits(b.turning)} سالگی</span> : null}</p>
                      <p className="text-sm text-muted">
                        {faDigits(b.day)} {(b.calendar === 'jalali' ? JALALI_MONTHS : GREGORIAN_MONTHS_FA)[b.month - 1]}
                        {b.calendar === 'gregorian' ? ' (میلادی)' : ''}
                      </p>
                    </div>
                    {b.next && <span className={`shrink-0 text-xs ${b.daysUntil === 0 ? 'font-semibold text-fun' : 'text-muted'}`}>{relativeDay(b.next, today)}</span>}
                  </div>
                  {b.nextAdjusted && <p className="mt-1 text-xs text-warn">امسال این روز در تقویم نیست؛ {formatDate(b.next!, { calendar: b.calendar, year: false })} یادآوری می‌شود.</p>}
                  {b.notes && <p className="mt-1 text-xs">{b.notes}</p>}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>تولدی ثبت نشده.</Empty>
        )}
      </section>

      {editB && <BirthdaySheet value={editB === 'new' ? null : editB} onClose={() => setEditB(null)} />}
      {editD && <DeadlineSheet value={editD === 'new' ? null : editD} today={today} onClose={() => setEditD(null)} />}
      {renew && <RenewSheet value={renew} today={today} onClose={() => setRenew(null)} />}
    </div>
  );
}

function useSave(onDone: () => void) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      toast(ok);
      onDone();
      router.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

function BirthdaySheet({ value, onClose }: { value: BirthdayView | null; onClose: () => void }) {
  const [name, setName] = useState(value?.name ?? '');
  const [calendar, setCalendar] = useState<CalendarKind>(value?.calendar ?? 'jalali');
  const [month, setMonth] = useState(value?.month ?? 1);
  const [day, setDay] = useState(value?.day ?? 1);
  const [year, setYear] = useState<string>(value?.year ? String(value.year) : '');
  const [notes, setNotes] = useState(value?.notes ?? '');
  const [days, setDays] = useState<number[]>(value?.reminderDays ?? [0, 3]);
  const [leapPolicy, setLeapPolicy] = useState(value?.leapPolicy ?? 'clamp');
  const { busy, run } = useSave(onClose);
  const months = calendar === 'jalali' ? JALALI_MONTHS : GREGORIAN_MONTHS_FA;
  const maxDay = monthLength(calendar, calendar === 'jalali' ? 1403 : 2024, month); // leap year so leap days are selectable
  const leapDay = (calendar === 'jalali' && month === 12 && day === 30) || (calendar === 'gregorian' && month === 2 && day === 29);
  const body = () => ({ name, calendar, month, day: Math.min(day, maxDay), year: year ? Number(year) : null, notes: notes || null, reminderDays: days, leapPolicy });

  return (
    <Sheet open onClose={onClose} title={value ? 'ویرایش تولد' : 'تولد جدید'}>
      <div className="space-y-4">
        <label className="block">
          <span className="label">نام</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
        </label>
        <div>
          <span className="label">تقویم</span>
          <Segmented value={calendar} onChange={setCalendar} options={[{ value: 'jalali', label: 'شمسی' }, { value: 'gregorian', label: 'میلادی' }]} />
          <p className="mt-1 text-xs text-muted">تولد هر سال بر اساس همین تقویم تکرار می‌شود.</p>
        </div>
        <div className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2">
          <select aria-label="روز" className="field" value={Math.min(day, maxDay)} onChange={(e) => setDay(Number(e.target.value))}>
            {Array.from({ length: maxDay }, (_, i) => i + 1).map((d) => <option key={d} value={d}>{faDigits(d)}</option>)}
          </select>
          <select aria-label="ماه" className="field" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {months.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <input aria-label="سال تولد (اختیاری)" className="field ltr text-center" inputMode="numeric" placeholder="سال (اختیاری)" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        </div>
        {leapDay && (
          <div className="space-y-2 rounded-xl bg-surface-2 p-3 text-sm">
            <p>این روز فقط در سال‌های کبیسه وجود دارد. در سال‌های دیگر:</p>
            <Segmented value={leapPolicy} onChange={setLeapPolicy} options={[{ value: 'clamp', label: 'روز قبل یادآوری شود' }, { value: 'skip', label: 'یادآوری نشود' }]} />
          </div>
        )}
        <div>
          <span className="label">یادآوری</span>
          <div className="flex flex-wrap gap-2">
            {DAY_REMINDERS.map((r) => (
              <ChipToggle key={r.v} on={days.includes(r.v)} onClick={() => setDays(days.includes(r.v) ? days.filter((x) => x !== r.v) : [...days, r.v])}>{r.l}</ChipToggle>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="label">یادداشت (مثلاً ایدهٔ هدیه)</span>
          <input className="field" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </label>
        <div className="flex gap-2">
          <button className="btn-primary flex-1" disabled={busy || !name.trim()} onClick={() => run(() => (value ? api(`/api/birthdays/${value.id}`, { method: 'PATCH', body: body() }) : api('/api/birthdays', { body: body() })), 'ذخیره شد')}>
            {busy && <Spinner />} ذخیره
          </button>
          {value && (
            <button className="btn-danger" disabled={busy} onClick={() => confirm(`تولد ${value.name} حذف شود؟`) && run(() => api(`/api/birthdays/${value.id}`, { method: 'DELETE' }), 'حذف شد')}>
              حذف
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function DeadlineSheet({ value, today, onClose }: { value: DeadlineView | null; today: string; onClose: () => void }) {
  const [title, setTitle] = useState(value?.title ?? '');
  const [kind, setKind] = useState<'insurance' | 'other'>((value?.kind as 'insurance') ?? 'other');
  const [dueDate, setDueDate] = useState<string | null>(value?.dueDate ?? addDays(today, 30));
  const [notes, setNotes] = useState(value?.notes ?? '');
  const [days, setDays] = useState<number[]>(value?.reminderDays ?? [30, 7, 1]);
  const { busy, run } = useSave(onClose);
  const body = () => ({ title, kind, dueDate, notes: notes || null, reminderDays: days });
  return (
    <Sheet open onClose={onClose} title={value ? 'ویرایش سررسید' : 'سررسید جدید'}>
      <div className="space-y-4">
        <label className="block">
          <span className="label">عنوان</span>
          <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً بیمهٔ شخص ثالث" maxLength={200} />
        </label>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'insurance', label: 'بیمه' }, { value: 'other', label: 'سایر' }]} />
        <DateInput label="تاریخ انقضا / سررسید" value={dueDate} onChange={setDueDate} today={today} allowEmpty={false} shortcuts={false} />
        <div>
          <span className="label">یادآوری</span>
          <div className="flex flex-wrap gap-2">
            {DAY_REMINDERS.map((r) => (
              <ChipToggle key={r.v} on={days.includes(r.v)} onClick={() => setDays(days.includes(r.v) ? days.filter((x) => x !== r.v) : [...days, r.v])}>{r.l}</ChipToggle>
            ))}
          </div>
        </div>
        <label className="block">
          <span className="label">توضیح</span>
          <textarea className="field min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary flex-1" disabled={busy || !title.trim() || !dueDate} onClick={() => run(() => (value ? api(`/api/deadlines/${value.id}`, { method: 'PATCH', body: body() }) : api('/api/deadlines', { body: body() })), 'ذخیره شد')}>
            {busy && <Spinner />} ذخیره
          </button>
          {value && (
            <>
              <button className="btn-ghost" disabled={busy} onClick={() => run(() => api(`/api/deadlines/${value.id}`, { method: 'PATCH', body: { archived: !value.archived } }), value.archived ? 'از بایگانی خارج شد' : 'بایگانی شد')}>
                {value.archived ? 'خروج از بایگانی' : 'بایگانی'}
              </button>
              <button className="btn-danger" disabled={busy} onClick={() => confirm(`«${value.title}» و سابقهٔ تمدیدش حذف شود؟`) && run(() => api(`/api/deadlines/${value.id}`, { method: 'DELETE' }), 'حذف شد')}>
                حذف
              </button>
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}

function RenewSheet({ value, today, onClose }: { value: DeadlineView; today: string; onClose: () => void }) {
  const cur = toCalendar(value.dueDate, 'jalali');
  // suggest one jalali year later, same month/day (clamped to the month length)
  const suggested = fromJalali(cur.y + 1, cur.m, Math.min(cur.d, monthLength('jalali', cur.y + 1, cur.m)));
  const [date, setDate] = useState<string | null>(suggested);
  const [note, setNote] = useState('');
  const { busy, run } = useSave(onClose);
  return (
    <Sheet open onClose={onClose} title={`تمدید «${value.title}»`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">سررسید فعلی: {formatDate(value.dueDate, { weekday: true })}. تاریخ فعلی در سابقهٔ تمدید ثبت می‌شود و یادآوری‌ها برای تاریخ جدید تنظیم می‌شوند.</p>
        <DateInput label="سررسید جدید" value={date} onChange={setDate} today={today} allowEmpty={false} shortcuts={false} />
        <label className="block">
          <span className="label">یادداشت (اختیاری، مثلاً شرکت بیمه یا مبلغ)</span>
          <input className="field" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
        </label>
        <button className="btn-primary w-full" disabled={busy || !date} onClick={() => run(() => api(`/api/deadlines/${value.id}`, { body: { newDueDate: date, note: note || null } }), 'تمدید ثبت شد')}>
          {busy && <Spinner />} ثبت تمدید
        </button>
      </div>
    </Sheet>
  );
}
