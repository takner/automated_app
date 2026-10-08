import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { env, features } from '@/lib/env';

const sub = z.object({
  endpoint: z.string().url().max(1000).refine((u) => u.startsWith('https://'), 'endpoint نامعتبر'),
  keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }),
});

export const GET = route(async (_req, { user }) => {
  const subs = await prisma.pushSubscription.findMany({ where: { userId: user.id }, select: { id: true, endpoint: true, userAgent: true, createdAt: true, lastSuccessAt: true, failureCount: true } });
  return {
    configured: features().push,
    publicKey: env().VAPID_PUBLIC_KEY ?? null,
    subscriptions: subs.map((s) => ({ ...s, endpoint: new URL(s.endpoint).host })),
  };
});

export const POST = route(async (req, { user }) => {
  if (!features().push) throw new HttpError(503, 'اعلان‌ها روی سرور پیکربندی نشده‌اند', 'push_not_configured');
  const s = sub.parse(await readJson(req));
  const ua = req.headers.get('user-agent')?.slice(0, 200) ?? null;
  // an endpoint belongs to one browser; re-subscribing moves it to the current user
  await prisma.pushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { userId: user.id, endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: ua },
    update: { userId: user.id, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent: ua, failureCount: 0 },
  });
  return { ok: true };
});

export const DELETE = route(async (req, { user }) => {
  const body = z.object({ endpoint: z.string().max(1000).optional(), id: z.string().optional() }).parse(await readJson(req));
  await prisma.pushSubscription.deleteMany({ where: { userId: user.id, OR: [{ endpoint: body.endpoint ?? '__none__' }, { id: body.id ?? '__none__' }] } });
  return { ok: true };
});
