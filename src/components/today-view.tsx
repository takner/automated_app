'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DayView, TaskItem } from '@/lib/services/tasks';
import type { Level, PlanResult, PlanBlock } from '@/lib/planner';
import type { BirthdayView } from '@/lib/services/dates-service';
import { faDigits, formatDate, formatMinutes, relativeDay, utcToLocal } from '@/lib/dates';
import { api } from './client-api';
import { TaskRow } from './task-row';
import { Empty, Segmented, Spinner, useToast } from './ui';

interface Props {
  tz: string;
  view: DayView;
  plan: PlanResult;
  energy: Level;
  events: Array<{ id: string; summary: string; allDay: boolean; start: string | null; end: string | null }>;
  birthdays: BirthdayView[];
  deadlines: Array<{ id: string; title: string; dueDate: string; daysUntil: number; kind: string }>;
  calendar: { status: string; lastSyncAt: string | null; error: string | null } | null;
}

const BLOCK_STYLE: Record<PlanBlock['kind'], string> = {
  task: 'border-work/30 bg-work-soft',
  break: 'border-rest/30 bg-rest-soft',
  rest: 'border-rest/30 bg-rest-soft',
  fun: 'border-fun/30 bg-fun-soft',
  fixed: 'border-line bg-surface-2',
};

export function TodayView({ tz, view, plan, energy, events, birthdays, deadlines, calendar }: Props) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const today = view.today;
  const all: TaskItem[] = [...view.overdue, ...view.items, ...view.unscheduled, ...view.upcoming];
  const byKey = new Map(all.map((i) => [i.key, i]));
  const top = plan.topPriorities.map((k) => byKey.get(k)).filter((x): x is TaskItem => !!x && x.status === 'todo');
  // every "task" block is a proposal; tasks the user already timed come back as "fixed"
  const proposed = plan.blocks.filter((b) => b.kind === 'task' && b.taskKey);
  const hhmm = (iso: string) => faDigits(utcToLocal(new Date(iso), tz).time);
  const calendarConnected = calendar?.status === 'active' || calendar?.status === 'error';

  async function accept(keys?: string[]) {
    setBusy(keys ? keys[0] : 'all');
    try {
      const { plan: draft } = await api<{ plan: { id: string } }>('/api/plan', { body: { date: today } });
      const r = await api<{ applied: number }>(`/api/plan/${draft.id}/accept`, { body: { keys } });
      toast(r.applied ? `زمان ${faDigits(r.applied)} کار ثبت شد` : 'چیزی برای ثبت نبود');
      router.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function setEnergy(e: Level) {
    try {
      await api('/api/energy', { body: { date: today, energy: e } });
      router.refresh();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const s = plan.summary;
  const totalBar = Math.max(1, s.workMinutes + s.personalTaskMinutes + s.restMinutes + s.funMinutes);
  const todayItems = view.items;
  const doneCount = todayItems.filter((i) => i.status === 'done').length;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted">امروز</p>
          <h1 className="text-2xl font-bold">{formatDate(today, { weekday: true })}</h1>
        </div>
        <div className="w-full sm:w-64">
          <span className="label">انرژی امروز</span>
          <Segmented value={energy} onChange={setEnergy} label="انرژی امروز" options={[{ value: 'low', label: 'کم' }, { value: 'medium', label: 'متوسط' }, { value: 'high', label: 'زیاد' }]} />
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <div className="space-y-6">
          <section aria-labelledby="top">
            <h2 id="top" className="section-title">مهم‌ترین‌های امروز</h2>
            {top.length ? (
              <ol className="space-y-2">
                {top.map((i, n) => (
                  <li key={i.key} className="card flex items-center gap-3 p-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{faDigits(n + 1)}</span>
                    <Link href={`/tasks/${i.taskId}${i.occurrenceDate ? `?occ=${i.occurrenceDate}` : ''}`} className="font-medium">
                      {i.title}
                    </Link>
                  </li>
                ))}
              </ol>
            ) : (
              <Empty>کار بازی برای امروز نیست. با دکمهٔ + چیزی ثبت کنید.</Empty>
            )}
          </section>

          {view.overdue.length > 0 && (
            <section aria-labelledby="overdue">
              <h2 id="overdue" className="section-title text-danger">
                عقب‌افتاده ({faDigits(view.overdue.length)}) — تصمیم بگیرید: انجام، انتقال یا رد
              </h2>
              <ul className="space-y-2">
                {view.overdue.map((i) => (
                  <TaskRow key={i.key} item={i} today={today} tz={tz} calendarConnected={calendarConnected} showDate />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby="todo">
            <h2 id="todo" className="section-title">
              کارهای امروز {todayItems.length > 0 && `(${faDigits(doneCount)} از ${faDigits(todayItems.length)})`}
            </h2>
            {todayItems.length ? (
              <ul className="space-y-2">
                {todayItems.map((i) => (
                  <TaskRow key={i.key} item={i} today={today} tz={tz} calendarConnected={calendarConnected} />
                ))}
              </ul>
            ) : (
              <Empty>برای امروز کاری زمان‌بندی نشده.</Empty>
            )}
            {view.unscheduled.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-sm text-muted">کارهای بدون تاریخ ({faDigits(view.unscheduled.length)})</summary>
                <ul className="mt-2 space-y-2">
                  {view.unscheduled.map((i) => (
                    <TaskRow key={i.key} item={i} today={today} tz={tz} calendarConnected={calendarConnected} />
                  ))}
                </ul>
              </details>
            )}
          </section>

          {(birthdays.length > 0 || deadlines.length > 0) && (
            <section aria-labelledby="dates">
              <h2 id="dates" className="section-title">موعدهای نزدیک</h2>
              <ul className="space-y-2">
                {deadlines.map((d) => (
                  <li key={d.id} className="card flex items-center justify-between gap-3 p-3">
                    <Link href={`/dates#d-${d.id}`} className="font-medium">
                      {d.kind === 'insurance' ? '🛡 ' : '⏳ '}
                      {d.title}
                    </Link>
                    <span className={`text-sm ${d.daysUntil <= 7 ? 'font-semibold text-danger' : 'text-muted'}`}>
                      {d.daysUntil < 0 ? `${faDigits(-d.daysUntil)} روز گذشته` : relativeDay(d.dueDate, today)}
                    </span>
                  </li>
                ))}
                {birthdays.map((b) => (
                  <li key={b.id} className="card flex items-center justify-between gap-3 p-3">
                    <Link href={`/dates#b-${b.id}`} className="font-medium">
                      🎂 تولد {b.name}
                      {b.turning ? <span className="text-sm font-normal text-muted"> ({faDigits(b.turning)} سالگی)</span> : null}
                    </Link>
                    <span className={`text-sm ${b.daysUntil === 0 ? 'font-semibold text-fun' : 'text-muted'}`}>{relativeDay(b.next!, today)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section aria-labelledby="plan" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="plan" className="section-title mb-0">برنامهٔ پیشنهادی روز</h2>
            {proposed.length > 0 && (
              <button className="btn-primary min-h-9 px-3" onClick={() => accept()} disabled={!!busy}>
                {busy === 'all' && <Spinner />} پذیرفتن همه
              </button>
            )}
          </div>

          <div className="card space-y-2 p-3">
            <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <span className="bg-work" style={{ width: `${(s.workMinutes / totalBar) * 100}%` }} />
              <span className="bg-personal" style={{ width: `${(s.personalTaskMinutes / totalBar) * 100}%` }} />
              <span className="bg-rest" style={{ width: `${(s.restMinutes / totalBar) * 100}%` }} />
              <span className="bg-fun" style={{ width: `${(s.funMinutes / totalBar) * 100}%` }} />
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs sm:grid-cols-4">
              <div><dt className="inline text-work">● کار: </dt><dd className="inline">{formatMinutes(s.workMinutes)}</dd></div>
              <div><dt className="inline text-personal">● شخصی: </dt><dd className="inline">{formatMinutes(s.personalTaskMinutes)}</dd></div>
              <div><dt className="inline text-rest">● استراحت: </dt><dd className="inline">{formatMinutes(s.restMinutes)}</dd></div>
              <div><dt className="inline text-fun">● تفریح: </dt><dd className="inline">{formatMinutes(s.funMinutes)}</dd></div>
            </dl>
            <p className="text-xs text-muted">پیشنهاد است؛ تا وقتی نپذیرید، کارها و تقویم شما تغییری نمی‌کنند.</p>
          </div>

          {plan.warnings.map((w) => (
            <p key={w} className="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn">{w}</p>
          ))}

          {events.filter((e) => e.allDay).map((e) => (
            <p key={e.id} className="rounded-xl bg-surface-2 px-3 py-2 text-sm">📅 تمام روز: {e.summary}</p>
          ))}

          {plan.blocks.length ? (
            <ol className="space-y-1.5">
              {plan.blocks.map((b, i) => {
                const isProposal = b.kind === 'task' && !!b.taskKey;
                return (
                  <li key={i} className={`flex items-start gap-3 rounded-xl border px-3 py-2 ${BLOCK_STYLE[b.kind]} ${isProposal ? 'border-dashed' : ''}`}>
                    <span className="ltr w-24 shrink-0 pt-0.5 text-xs font-medium text-muted">
                      {hhmm(b.start)}–{hhmm(b.end)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{b.title}</p>
                      <p className="text-xs text-muted">{b.reason}</p>
                    </div>
                    {isProposal && (
                      <button className="chip shrink-0" onClick={() => accept([b.taskKey!])} disabled={!!busy} aria-label={`پذیرفتن زمان ${b.title}`}>
                        {busy === b.taskKey ? <Spinner /> : 'قبول'}
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <Empty>امروز زمان آزادی برای برنامه‌ریزی نمانده.</Empty>
          )}

          {plan.unscheduled.length > 0 && (
            <div>
              <h3 className="section-title mt-4">جا نشد ({faDigits(plan.unscheduled.length)})</h3>
              <ul className="space-y-1.5">
                {plan.unscheduled.map((u) => (
                  <li key={u.taskKey} className="rounded-xl border border-line px-3 py-2 text-sm">
                    <span className="font-medium">{u.title}</span>
                    <span className="block text-xs text-muted">{u.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-muted">
            {calendar
              ? calendar.status === 'revoked'
                ? 'اتصال Google Calendar لغو شده؛ از تنظیمات دوباره وصل شوید.'
                : `قرارهای Google Calendar لحاظ شده‌اند${calendar.lastSyncAt ? ` (آخرین همگام‌سازی ${faDigits(utcToLocal(new Date(calendar.lastSyncAt), tz).time)})` : ''}.${calendar.error ? ` خطا: ${calendar.error}` : ''}`
              : 'Google Calendar وصل نیست؛ فقط زمان‌های ثابت و کارهای زمان‌دار لحاظ شده‌اند.'}
          </p>
        </section>
      </div>
    </div>
  );
}
