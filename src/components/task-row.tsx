'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TaskItem } from '@/lib/services/tasks';
import { addDays, faDigits, formatDate, formatMinutes, relativeDay, utcToLocal } from '@/lib/dates';
import { api } from './client-api';
import { DateInput, TimeInput } from './date-input';
import { CATEGORY_LABEL, Sheet, Spinner, useToast } from './ui';

export function TaskRow({ item, today, tz, calendarConnected, showDate = false }: { item: TaskItem; today: string; tz: string; calendarConnected: boolean; showDate?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [moving, setMoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const local = item.start ? utcToLocal(new Date(item.start), tz) : null;
  const [moveDate, setMoveDate] = useState<string | null>(local?.date ?? item.date ?? today);
  const [moveTime, setMoveTime] = useState<string | null>(local?.time ?? null);
  // optimistic: flip immediately, reconcile when the refreshed server data arrives
  const [done, setDone] = useState(item.status === 'done');
  useEffect(() => setDone(item.status === 'done'), [item.status]);
  const key = encodeURIComponent(item.key);

  async function act(action: string, body: unknown = {}, okText?: string) {
    setBusy(true);
    const prevDone = done;
    if (action === 'done' || action === 'undo') setDone(action === 'done');
    try {
      await api(`/api/items/${key}/${action}`, { body });
      if (okText) toast(okText);
      setMenu(false);
      setMoving(false);
      router.refresh();
    } catch (e) {
      setDone(prevDone);
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const editHref = `/tasks/${item.taskId}${item.occurrenceDate ? `?occ=${item.occurrenceDate}` : ''}`;

  return (
    <li className={`card flex items-start gap-3 p-3 ${done ? 'opacity-60' : ''}`}>
      <button
        onClick={() => act(done ? 'undo' : 'done', {}, done ? undefined : 'انجام شد ✓')}
        disabled={busy}
        aria-label={done ? 'برگرداندن به انجام‌نشده' : 'انجام شد'}
        className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2 ${done ? 'border-accent bg-accent text-accent-ink' : 'border-line hover:border-accent'}`}
      >
        {busy ? <Spinner /> : done ? '✓' : ''}
      </button>
      <div className="min-w-0 flex-1">
        <Link href={editHref} className={`block font-medium ${done ? 'line-through' : ''}`}>
          {item.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {local && <span className="font-medium text-ink">{faDigits(local.time)}</span>}
          {showDate && item.date && <span>{relativeDay(item.date, today)} · {formatDate(item.date, { year: false })}</span>}
          {item.dueDate && !showDate && item.dueDate !== today && <span>موعد: {formatDate(item.dueDate, { year: false })}</span>}
          {item.dueTime && <span>تا {faDigits(item.dueTime)}</span>}
          <span className={`rounded-full px-2 py-0.5 ${item.category === 'work' ? 'bg-work-soft text-work' : 'bg-personal-soft text-personal'}`}>{CATEGORY_LABEL[item.category]}</span>
          {item.priority === 'high' && <span className="text-danger">مهم</span>}
          {item.durationMinutes ? <span>{formatMinutes(item.durationMinutes)}</span> : null}
          {item.recurring && <span title="تکرارشونده">↻</span>}
          {item.reminderOffsets.length > 0 && <span title="یادآوری دارد">🔔</span>}
          {item.overdue && <span className="text-danger">عقب‌افتاده</span>}
        </div>
      </div>
      <button className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2" onClick={() => setMenu(true)} aria-label="اقدام‌ها">
        ⋯
      </button>

      <Sheet open={menu && !moving} onClose={() => setMenu(false)} title={item.title}>
        <div className="space-y-4">
          <div>
            <p className="section-title">بعداً یادآوری کن</p>
            <div className="flex flex-wrap gap-2">
              <button className="chip" onClick={() => act('snooze', { minutes: 30 }, 'نیم ساعت دیگر یادآوری می‌شود')}>۳۰ دقیقه</button>
              <button className="chip" onClick={() => act('snooze', { minutes: 60 }, 'یک ساعت دیگر یادآوری می‌شود')}>۱ ساعت</button>
              <button className="chip" onClick={() => act('snooze', { minutes: 180 }, 'سه ساعت دیگر یادآوری می‌شود')}>۳ ساعت</button>
              <button className="chip" onClick={() => act('snooze', { tomorrowAt: '09:00' }, 'فردا ساعت ۹ یادآوری می‌شود')}>فردا ۹ صبح</button>
            </div>
          </div>
          <div className="grid gap-2">
            <button className="btn-ghost justify-start" onClick={() => setMoving(true)}>⏱ تغییر زمان / جابجایی</button>
            {item.overdue && (
              <>
                <button className="btn-ghost justify-start" onClick={() => act('move', { date: today }, 'به امروز منتقل شد')}>انتقال به امروز</button>
                <button className="btn-ghost justify-start" onClick={() => act('move', { date: addDays(today, 1) }, 'به فردا منتقل شد')}>انتقال به فردا</button>
              </>
            )}
            {item.recurring && !done && (
              <button className="btn-ghost justify-start" onClick={() => act('skip', {}, 'این نوبت رد شد')}>رد کردن فقط این نوبت</button>
            )}
            <Link className="btn-ghost justify-start" href={editHref}>✎ ویرایش{item.recurring ? ' (این نوبت یا کل مجموعه)' : ''}</Link>
            {calendarConnected && (item.start || item.date) && (
              <button className="btn-ghost justify-start" onClick={() => act('calendar', {}, 'در تقویم Google (تقویم هم‌روز) ثبت شد')}>📅 ارسال به Google Calendar</button>
            )}
          </div>
        </div>
      </Sheet>

      <Sheet open={moving} onClose={() => setMoving(false)} title="تغییر زمان">
        <div className="space-y-4">
          <DateInput value={moveDate} onChange={setMoveDate} today={today} allowEmpty={false} />
          <TimeInput label="ساعت (اختیاری)" value={moveTime} onChange={setMoveTime} />
          {item.recurring && <p className="text-xs text-muted">فقط همین نوبت جابجا می‌شود؛ بقیهٔ تکرارها تغییری نمی‌کنند.</p>}
          <button className="btn-primary w-full" disabled={!moveDate || busy} onClick={() => act('move', { date: moveDate, time: moveTime }, 'زمان تغییر کرد')}>
            ذخیره
          </button>
        </div>
      </Sheet>
    </li>
  );
}
