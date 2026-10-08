'use client';

import { useCallback, useEffect, useState } from 'react';
import { faDigits, formatInstant } from '@/lib/dates';
import { api } from './client-api';
import { Spinner, useToast } from './ui';

interface Status {
  upcoming: Row[];
  recent: Row[];
  counts: Record<string, number>;
  worker: { beatAt: string; ageSeconds: number } | null;
  overdue: number;
}
interface Row {
  id: string;
  title: string;
  status: string;
  fireAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
  acceptedCount: number | null;
  lastError: string | null;
  sourceType: string;
}

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const STATUS_FA: Record<string, string> = {
  pending: 'در صف',
  processing: 'در حال ارسال',
  sent: 'تحویل سرویس Push شد',
  failed: 'ناموفق',
  cancelled: 'لغو',
  skipped: 'ارسال نشد',
};
const ERR_FA: Record<string, string> = {
  no_subscription: 'هیچ دستگاهی برای اعلان ثبت نشده بود',
  notifications_disabled: 'اعلان‌ها خاموش بودند',
  expired: 'خیلی دیر شده بود (سرور در دسترس نبود)',
  deferred_quiet_hours: 'به خاطر ساعات سکوت به تعویق افتاد',
  subscription_expired: 'اشتراک این دستگاه منقضی شده بود',
};

export function NotificationsPanel({ configured, publicKey, tz }: { configured: boolean; publicKey: string | null; tz: string }) {
  const toast = useToast();
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>('default');
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [isIos, setIsIos] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<Status | null>(null);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api<Status>('/api/notifications'));
    } catch {
      // shown as missing status
    }
  }, []);

  useEffect(() => {
    const ua = navigator.userAgent;
    setIsIos(/iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document));
    setStandalone(window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true);
    if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPerm('unsupported');
      setSubscribed(false);
    } else {
      setPerm(Notification.permission);
      navigator.serviceWorker.ready.then((r) => r.pushManager.getSubscription()).then((s) => setSubscribed(!!s)).catch(() => setSubscribed(false));
    }
    refresh();
  }, [refresh]);

  async function enable() {
    if (!publicKey) return;
    setBusy('enable');
    try {
      const p = await Notification.requestPermission();
      setPerm(p);
      if (p !== 'granted') throw new Error('اجازهٔ اعلان داده نشد. از تنظیمات مرورگر/گوشی آن را فعال کنید.');
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) }));
      await api('/api/push', { body: sub.toJSON() });
      setSubscribed(true);
      toast('اعلان روی این دستگاه فعال شد');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    setBusy('disable');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await api('/api/push', { method: 'DELETE', body: { endpoint: sub.endpoint } });
        await sub.unsubscribe();
      }
      setSubscribed(false);
      toast('اعلان این دستگاه قطع شد');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  async function test() {
    setBusy('test');
    try {
      const r = await api<{ status: string; accepted: number; detail?: string }>('/api/push/test', { body: {} });
      if (r.status === 'sent') toast(`پیام به ${faDigits(r.accepted)} دستگاه تحویل سرویس Push شد. اگر روی صفحه نیامد، تنظیمات اعلان گوشی را بررسی کنید.`);
      else toast(`ارسال نشد: ${ERR_FA[r.detail ?? ''] ?? r.detail ?? r.status}`, 'error');
      refresh();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  }

  if (!configured) {
    return <p className="rounded-xl bg-warn-soft p-3 text-sm text-warn">اعلان‌ها روی سرور پیکربندی نشده‌اند (کلیدهای VAPID تنظیم نشده‌اند).</p>;
  }

  return (
    <div className="space-y-4">
      {isIos && !standalone && (
        <div className="rounded-xl bg-surface-2 p-3 text-sm">
          <p className="font-medium">آیفون/آیپد: اعلان فقط بعد از نصب روی صفحهٔ اصلی کار می‌کند (iOS ۱۶٫۴ به بعد)</p>
          <ol className="mt-1 list-inside list-decimal space-y-0.5 text-muted">
            <li>این صفحه را در Safari باز کنید.</li>
            <li>دکمهٔ اشتراک‌گذاری (مربع با فلش) ← «Add to Home Screen».</li>
            <li>هم‌روز را از آیکن صفحهٔ اصلی باز کنید و دوباره به همین بخش بیایید.</li>
            <li>«فعال‌سازی اعلان» را بزنید و اجازه دهید.</li>
          </ol>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">این دستگاه:</span>
        {perm === 'unsupported' ? (
          <span className="text-danger">این مرورگر از اعلان وب پشتیبانی نمی‌کند{isIos && !standalone ? ' (ابتدا روی صفحهٔ اصلی نصب کنید)' : ''}.</span>
        ) : perm === 'denied' ? (
          <span className="text-danger">اجازهٔ اعلان رد شده است؛ از تنظیمات مرورگر/گوشی آن را باز کنید.</span>
        ) : subscribed ? (
          <span className="text-accent">● فعال</span>
        ) : (
          <span>غیرفعال</span>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {perm !== 'unsupported' && !subscribed && (
          <button className="btn-primary" onClick={enable} disabled={!!busy || perm === 'denied'}>
            {busy === 'enable' && <Spinner />} فعال‌سازی اعلان در این دستگاه
          </button>
        )}
        {subscribed && (
          <button className="btn-ghost" onClick={disable} disabled={!!busy}>
            {busy === 'disable' && <Spinner />} قطع اعلان این دستگاه
          </button>
        )}
        <button className="btn-ghost" onClick={test} disabled={!!busy}>
          {busy === 'test' && <Spinner />} ارسال اعلان آزمایشی
        </button>
      </div>
      <p className="text-xs text-muted">
        یادآوری‌ها از سرور فرستاده می‌شوند و لازم نیست برنامه باز باشد. «تحویل سرویس Push» یعنی سرویس اعلان مرورگر پیام را پذیرفته؛ نمایش آن روی گوشی به اینترنت و تنظیمات دستگاه بستگی دارد و تضمینی نیست. آلارم آفلاین پشتیبانی نمی‌شود.
      </p>

      {status && (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted">
            سرویس پس‌زمینه:{' '}
            {status.worker ? (
              status.worker.ageSeconds < 120 ? <span className="text-accent">فعال (آخرین ضربان {faDigits(status.worker.ageSeconds)} ثانیه پیش)</span> : <span className="text-danger">بی‌پاسخ از {faDigits(Math.round(status.worker.ageSeconds / 60))} دقیقه پیش</span>
            ) : (
              <span className="text-danger">هنوز گزارشی نداده</span>
            )}
            {status.overdue > 0 && <span className="text-danger"> · {faDigits(status.overdue)} یادآوری عقب افتاده</span>}
          </p>
          <details>
            <summary className="cursor-pointer text-muted">یادآوری‌های پیش رو ({faDigits(status.upcoming.length)})</summary>
            <ul className="mt-2 space-y-1">
              {status.upcoming.map((n) => (
                <li key={n.id} className="flex justify-between gap-2 rounded-lg bg-surface-2 px-2 py-1.5">
                  <span className="truncate">{n.title}</span>
                  <span className="shrink-0 text-xs text-muted">{formatInstant(new Date(n.nextAttemptAt), tz, { date: true })}</span>
                </li>
              ))}
            </ul>
          </details>
          <details>
            <summary className="cursor-pointer text-muted">ارسال‌های اخیر ({faDigits(status.recent.length)})</summary>
            <ul className="mt-2 space-y-1">
              {status.recent.map((n) => (
                <li key={n.id} className="rounded-lg bg-surface-2 px-2 py-1.5">
                  <div className="flex justify-between gap-2">
                    <span className="truncate">{n.title}</span>
                    <span className={`shrink-0 text-xs ${n.status === 'sent' ? 'text-accent' : 'text-danger'}`}>{STATUS_FA[n.status] ?? n.status}</span>
                  </div>
                  {n.lastError && n.status !== 'sent' && <p className="text-xs text-muted">{ERR_FA[n.lastError] ?? n.lastError}</p>}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}
