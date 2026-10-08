'use client';

import { useEffect, useState } from 'react';

/** Registers the service worker and offers a reload when a new release is waiting. */
export function SwRegister() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let reg: ServiceWorkerRegistration | undefined;
    const track = (r: ServiceWorkerRegistration) => {
      if (r.waiting && navigator.serviceWorker.controller) setWaiting(r.waiting);
      r.addEventListener('updatefound', () => {
        const sw = r.installing;
        sw?.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(sw);
        });
      });
    };
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((r) => {
        reg = r;
        track(r);
      })
      .catch(() => {});
    let reloading = false;
    const onChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onChange);
    const onVisible = () => document.visibilityState === 'visible' && reg?.update().catch(() => {});
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onChange);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  if (!waiting) return null;
  return (
    <div role="status" className="fixed inset-x-3 top-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-sm text-bg shadow-lg">
      <span>نسخهٔ جدید هم‌روز آماده است.</span>
      <button className="rounded-lg bg-accent px-3 py-1.5 font-medium text-accent-ink" onClick={() => waiting.postMessage('SKIP_WAITING')}>
        به‌روزرسانی
      </button>
    </div>
  );
}
