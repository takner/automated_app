'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { WEEK_ORDER, WEEKDAYS_FA, faDigits, formatInstant } from '@/lib/dates';
import { api } from './client-api';
import { NotificationsPanel } from './notifications-panel';
import { ChipToggle, Segmented, Spinner, useToast } from './ui';

interface Settings {
  timezone: string;
  workDays: number[];
  workStart: string;
  workEnd: string;
  sleepStart: string;
  sleepEnd: string;
  minRestMinutes: number;
  minFunMinutes: number;
  focusBlockMinutes: number;
  breakMinutes: number;
  notificationsEnabled: boolean;
  quietStart: string | null;
  quietEnd: string | null;
  notificationPreview: boolean;
  dateReminderTime: string;
}
interface Block {
  id: string;
  title: string;
  days: number[];
  start: string;
  end: string;
  kind: string;
}
interface Calendar {
  configured: boolean;
  connection: {
    googleEmail: string | null;
    status: string;
    lastSyncAt: string | null;
    lastSyncError: string | null;
    hasAppCalendar: boolean;
    sources: Array<{ id: string; summary: string; color: string | null; primary: boolean; selected: boolean; isAppCalendar: boolean }>;
  } | null;
}

const TIMEZONES = ['Asia/Tehran', 'Asia/Dubai', 'Europe/Istanbul', 'Europe/London', 'Europe/Berlin', 'America/New_York', 'America/Toronto', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'];

function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="card space-y-4 p-4">
      <h2 className="text-lg font-bold">{title}</h2>
      {children}
    </section>
  );
}

function TimeField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input type="time" className="field ltr" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}

function NumField({ label, value, onChange, min, max }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input className="field ltr" type="number" min={min} max={max} value={value} onChange={(e) => onChange(Math.max(min, Math.min(max, Number(e.target.value) || 0)))} />
    </label>
  );
}

export function SettingsView(props: {
  settings: Settings;
  blocks: Block[];
  push: { configured: boolean; publicKey: string | null };
  calendar: Calendar;
  voice: { stt: boolean; aiExtract: boolean; consent: boolean };
  email: string;
  flash: { calendar?: string; error?: string };
}) {
  const router = useRouter();
  const toast = useToast();
  const [s, setS] = useState(props.settings);
  const [busy, setBusy] = useState<string | null>(null);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => ({ ...x, [k]: v }));

  async function run(key: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(key);
    try {
      await fn();
      if (ok) toast(ok);
      router.refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  const saveSettings = (keys: Array<keyof Settings>) =>
    run('settings', () => api('/api/settings', { method: 'PUT', body: Object.fromEntries(keys.map((k) => [k, s[k]])) }), 'ذخیره شد');

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-2xl font-bold">تنظیمات</h1>
      {props.flash.calendar === 'connected' && <p className="rounded-xl bg-accent-soft p-3 text-sm text-accent">Google Calendar وصل شد.</p>}
      {props.flash.error && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{props.flash.error}</p>}

      <Section title="برنامهٔ روزانه">
        <div>
          <span className="label">روزهای کاری</span>
          <div className="flex flex-wrap gap-1.5">
            {WEEK_ORDER.map((d) => (
              <ChipToggle key={d} on={s.workDays.includes(d)} onClick={() => set('workDays', s.workDays.includes(d) ? s.workDays.filter((x) => x !== d) : [...s.workDays, d])}>
                {WEEKDAYS_FA[d]}
              </ChipToggle>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <TimeField label="شروع کار" value={s.workStart} onChange={(v) => set('workStart', v)} />
          <TimeField label="پایان کار" value={s.workEnd} onChange={(v) => set('workEnd', v)} />
          <TimeField label="شروع خواب" value={s.sleepStart} onChange={(v) => set('sleepStart', v)} />
          <TimeField label="بیداری" value={s.sleepEnd} onChange={(v) => set('sleepEnd', v)} />
          <NumField label="حداقل استراحت روزانه (دقیقه)" value={s.minRestMinutes} onChange={(v) => set('minRestMinutes', v)} min={0} max={600} />
          <NumField label="حداقل تفریح روزانه (دقیقه)" value={s.minFunMinutes} onChange={(v) => set('minFunMinutes', v)} min={0} max={600} />
          <NumField label="حداکثر کار پیوسته (دقیقه)" value={s.focusBlockMinutes} onChange={(v) => set('focusBlockMinutes', v)} min={25} max={300} />
          <NumField label="طول استراحت کوتاه (دقیقه)" value={s.breakMinutes} onChange={(v) => set('breakMinutes', v)} min={5} max={60} />
        </div>
        <label className="block">
          <span className="label">منطقهٔ زمانی</span>
          <select className="field ltr" value={s.timezone} onChange={(e) => set('timezone', e.target.value)}>
            {[...new Set([s.timezone, ...TIMEZONES])].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <button className="btn-primary" disabled={busy === 'settings'} onClick={() => saveSettings(['workDays', 'workStart', 'workEnd', 'sleepStart', 'sleepEnd', 'minRestMinutes', 'minFunMinutes', 'focusBlockMinutes', 'breakMinutes', 'timezone'])}>
          {busy === 'settings' && <Spinner />} ذخیرهٔ برنامهٔ روزانه
        </button>
      </Section>

      <Section title="زمان‌های ثابت">
        <p className="text-sm text-muted">بازه‌هایی که برنامه‌ریز نباید به آن‌ها دست بزند (ورزش، رفت‌وآمد، شام خانوادگی…).</p>
        <FixedBlocks blocks={props.blocks} onChange={() => router.refresh()} />
      </Section>

      <Section id="notifications" title="اعلان‌ها">
        <NotificationsPanel configured={props.push.configured} publicKey={props.push.publicKey} tz={s.timezone} />
        <hr className="border-line" />
        <label className="flex items-center justify-between gap-3">
          <span>همهٔ یادآوری‌ها روشن باشند</span>
          <input type="checkbox" className="size-5" checked={s.notificationsEnabled} onChange={(e) => set('notificationsEnabled', e.target.checked)} />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>نمایش متن کامل در اعلان (در غیر این صورت فقط «یادآوری تازه»)</span>
          <input type="checkbox" className="size-5" checked={s.notificationPreview} onChange={(e) => set('notificationPreview', e.target.checked)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="label">شروع ساعات سکوت</span>
            <input type="time" className="field ltr" value={s.quietStart ?? ''} onChange={(e) => set('quietStart', e.target.value || null)} />
          </label>
          <label className="block">
            <span className="label">پایان ساعات سکوت</span>
            <input type="time" className="field ltr" value={s.quietEnd ?? ''} onChange={(e) => set('quietEnd', e.target.value || null)} />
          </label>
          <TimeField label="ساعت یادآوری تولد و سررسید" value={s.dateReminderTime} onChange={(v) => set('dateReminderTime', v)} />
        </div>
        <p className="text-xs text-muted">یادآوری‌هایی که در ساعات سکوت بیفتند، در پایان آن ارسال می‌شوند.</p>
        <button className="btn-primary" disabled={busy === 'settings'} onClick={() => saveSettings(['notificationsEnabled', 'notificationPreview', 'quietStart', 'quietEnd', 'dateReminderTime'])}>
          {busy === 'settings' && <Spinner />} ذخیرهٔ تنظیمات اعلان
        </button>
      </Section>

      <Section title="Google Calendar">
        <CalendarPanel calendar={props.calendar} tz={s.timezone} busy={busy} run={run} />
      </Section>

      <Section title="ثبت صوتی">
        {props.voice.stt ? (
          <p className="text-sm">
            فعال است. صدا برای تبدیل به متن به سرویس OpenAI فرستاده می‌شود و در هم‌روز ذخیره نمی‌شود.{' '}
            {props.voice.consent ? 'اجازهٔ شما ثبت شده است.' : 'اولین بار که ضبط کنید، اجازه خواسته می‌شود.'}
          </p>
        ) : (
          <p className="text-sm text-warn">تبدیل صوت هنوز پیکربندی نشده است (کلید سرویس تبدیل گفتار روی سرور تنظیم نشده). ثبت متنی کار می‌کند.</p>
        )}
        <p className="text-sm text-muted">{props.voice.aiExtract ? 'برداشت هوشمند متن (Claude) فعال است؛ نتیجه همیشه پیش از ثبت به شما نشان داده می‌شود.' : 'برداشت متن با قواعد داخلی انجام می‌شود (سرویس هوش مصنوعی پیکربندی نشده).'}</p>
      </Section>

      <Section title="حساب">
        <p className="text-sm text-muted ltr text-right">{props.email}</p>
        <PasswordForm />
        <div className="flex flex-wrap gap-2">
          <a className="btn-ghost" href="/api/export">⬇ دریافت همهٔ داده‌ها (JSON)</a>
          <button
            className="btn-danger"
            disabled={busy === 'logout'}
            onClick={() =>
              run('logout', async () => {
                try {
                  const reg = await navigator.serviceWorker?.ready;
                  reg?.active?.postMessage('CLEAR_PRIVATE');
                  const sub = await reg?.pushManager.getSubscription();
                  if (sub) {
                    await api('/api/push', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
                    await sub.unsubscribe().catch(() => {});
                  }
                } catch {
                  // no service worker: nothing to clear
                }
                await api('/api/auth/logout', { body: {} });
                window.location.href = '/login';
              })
            }
          >
            خروج
          </button>
        </div>
        <p className="text-xs text-muted">خروج، اعلان‌های این دستگاه را هم قطع می‌کند.</p>
      </Section>
    </div>
  );
}

function FixedBlocks({ blocks, onChange }: { blocks: Block[]; onChange: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState('');
  const [days, setDays] = useState<number[]>([6, 7, 1, 2, 3]);
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('19:00');
  const [kind, setKind] = useState<'personal' | 'rest' | 'fun'>('personal');
  const kindLabel = { personal: 'شخصی', rest: 'استراحت', fun: 'تفریح' } as Record<string, string>;
  async function add() {
    try {
      await api('/api/fixed-blocks', { body: { title, days, start, end, kind } });
      setTitle('');
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  async function remove(id: string) {
    try {
      await api(`/api/fixed-blocks?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      onChange();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  }
  return (
    <div className="space-y-3">
      {blocks.length > 0 && (
        <ul className="space-y-1.5">
          {blocks.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
              <span>
                {b.title} · <span className="ltr">{faDigits(b.start)}–{faDigits(b.end)}</span> · {b.days.map((d) => WEEKDAYS_FA[d]).join('، ')} · {kindLabel[b.kind]}
              </span>
              <button className="text-danger" onClick={() => remove(b.id)} aria-label={`حذف ${b.title}`}>✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-2 rounded-xl border border-dashed border-line p-3">
        <input className="field" placeholder="عنوان، مثلاً باشگاه" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex flex-wrap gap-1.5">
          {WEEK_ORDER.map((d) => (
            <ChipToggle key={d} on={days.includes(d)} onClick={() => setDays(days.includes(d) ? days.filter((x) => x !== d) : [...days, d])}>{WEEKDAYS_FA[d]}</ChipToggle>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <TimeField label="از" value={start} onChange={setStart} />
          <TimeField label="تا" value={end} onChange={setEnd} />
        </div>
        <Segmented value={kind} onChange={setKind} options={[{ value: 'personal', label: 'شخصی' }, { value: 'rest', label: 'استراحت' }, { value: 'fun', label: 'تفریح' }]} />
        <button className="btn-ghost w-full" disabled={!title.trim() || !days.length} onClick={add}>+ افزودن</button>
      </div>
    </div>
  );
}

function CalendarPanel({ calendar, tz, busy, run }: { calendar: Calendar; tz: string; busy: string | null; run: (k: string, fn: () => Promise<unknown>, ok?: string) => Promise<void> }) {
  const c = calendar.connection;
  const [selected, setSelected] = useState<string[]>(c?.sources.filter((s) => s.selected).map((s) => s.id) ?? []);
  if (!calendar.configured) {
    return <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">اتصال Google روی سرور پیکربندی نشده است (Client ID/Secret یا کلید رمزگذاری تنظیم نشده).</p>;
  }
  if (!c) {
    return (
      <div className="space-y-3 text-sm">
        <p>با اتصال، قرارهای تقویم‌هایی که انتخاب می‌کنید برای تشخیص زمان آزاد خوانده می‌شوند. هم‌روز فقط در تقویم اختصاصی خودش («هم‌روز») و فقط با دستور شما رویداد می‌سازد و به قرارهای دیگر دست نمی‌زند.</p>
        <a href="/api/calendar?connect=1" className="btn-primary">اتصال به Google Calendar</a>
      </div>
    );
  }
  const toggle = (id: string) => setSelected((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  return (
    <div className="space-y-3 text-sm">
      <p>
        حساب: <span className="ltr">{c.googleEmail}</span> ·{' '}
        {c.status === 'active' ? <span className="text-accent">متصل</span> : c.status === 'revoked' ? <span className="text-danger">دسترسی لغو شده</span> : <span className="text-warn">خطا</span>}
      </p>
      <p className="text-muted">آخرین همگام‌سازی: {c.lastSyncAt ? formatInstant(new Date(c.lastSyncAt), tz, { date: true }) : 'هنوز انجام نشده'}</p>
      {c.lastSyncError && <p className="rounded-lg bg-danger-soft px-3 py-2 text-danger">{c.lastSyncError}</p>}
      {c.status === 'revoked' && <a href="/api/calendar?connect=1" className="btn-primary">اتصال دوباره</a>}
      <div>
        <p className="label">تقویم‌هایی که زمان شما را اشغال می‌کنند</p>
        <ul className="space-y-1">
          {c.sources.map((s) => (
            <li key={s.id}>
              <label className="flex items-center gap-2">
                <input type="checkbox" className="size-4" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                <span className="inline-block size-3 rounded-full" style={{ background: s.color ?? '#999' }} />
                {s.summary}
                {s.primary && <span className="text-xs text-muted">(اصلی)</span>}
                {s.isAppCalendar && <span className="text-xs text-muted">(ساخته‌شده توسط هم‌روز)</span>}
              </label>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={!!busy} onClick={() => run('cal-sel', async () => { await api('/api/calendar', { method: 'PATCH', body: { selected } }); await api('/api/calendar', { body: {} }); }, 'ذخیره و همگام‌سازی شد')}>
          {busy === 'cal-sel' && <Spinner />} ذخیرهٔ انتخاب
        </button>
        <button className="btn-ghost" disabled={!!busy} onClick={() => run('cal-sync', () => api('/api/calendar', { body: {} }), 'همگام‌سازی شد')}>
          {busy === 'cal-sync' && <Spinner />} همگام‌سازی الان
        </button>
        <button className="btn-danger" disabled={!!busy} onClick={() => confirm('اتصال قطع و توکن‌های ذخیره‌شده حذف شوند؟ رویدادهای ساخته‌شده در Google باقی می‌مانند.') && run('cal-off', () => api('/api/calendar', { method: 'DELETE' }), 'اتصال قطع شد')}>
          قطع اتصال
        </button>
      </div>
    </div>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api('/api/auth/password', { body: { current, next } });
          toast('رمز عوض شد؛ نشست‌های دیگر خارج شدند');
          setCurrent('');
          setNext('');
        } catch (err) {
          toast((err as Error).message, 'error');
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="label">تغییر رمز عبور</p>
      <input className="field ltr" type="password" autoComplete="current-password" placeholder="رمز فعلی" value={current} onChange={(e) => setCurrent(e.target.value)} />
      <input className="field ltr" type="password" autoComplete="new-password" placeholder="رمز جدید (حداقل ۱۲ نویسه)" value={next} onChange={(e) => setNext(e.target.value)} minLength={12} />
      <button className="btn-ghost" disabled={busy || next.length < 12}>{busy && <Spinner />} تغییر رمز</button>
    </form>
  );
}
