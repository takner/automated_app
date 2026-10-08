// The service worker is served from a route so each release embeds its version: a new deploy
// changes the script bytes, the browser installs it as "waiting", and the app shows an update
// banner. Only hashed static assets and the offline page are cached — never API responses,
// OAuth callbacks, audio or any page HTML with private data.
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

const script = (release: string) => `
const VERSION = ${JSON.stringify(release)};
const STATIC_CACHE = 'hz-static-' + VERSION;
const OFFLINE_URL = '/offline';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((c) => c.addAll([OFFLINE_URL, '/icons/icon-192.png', '/icons/badge-96.png']))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== STATIC_CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_PRIVATE') {
    // Nothing private is cached by design; drop everything except static assets anyway.
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k)))));
  }
});

function isStatic(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/') || /\\.(woff2?|ttf)$/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // private data: network only, never cached
  if (isStatic(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(async () => (await caches.match(OFFLINE_URL)) || Response.error()));
  }
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'هم‌روز', body: event.data && event.data.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'هم‌روز', {
    body: data.body || '',
    tag: data.tag,
    dir: 'rtl',
    lang: 'fa',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) return c.navigate(target);
        return;
      }
    }
    return self.clients.openWindow(target);
  })());
});
`;

export function GET() {
  return new Response(script(env().APP_RELEASE), {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'service-worker-allowed': '/',
    },
  });
}
