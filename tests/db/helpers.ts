import { prisma } from '@/lib/db';

export async function makeUser(email = `u${Math.random().toString(36).slice(2)}@test.local`) {
  return prisma.user.create({ data: { email, settings: { create: { quietStart: null, quietEnd: null } } } });
}

export const pending = (userId: string) =>
  prisma.notification.findMany({ where: { userId, status: 'pending' }, orderBy: { fireAt: 'asc' } });

/** Minimal fetch stub: routes by "METHOD url-substring". */
export function stubFetch(routes: Array<{ match: (method: string, url: string) => boolean; reply: (body: unknown) => { status: number; json?: unknown } }>) {
  const calls: Array<{ method: string; url: string; body: unknown }> = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // form bodies stay as strings
      }
    } else if (body instanceof URLSearchParams) body = Object.fromEntries(body);
    calls.push({ method, url, body });
    const r = routes.find((x) => x.match(method, url));
    if (!r) return new Response(JSON.stringify({ error: { message: 'no stub' } }), { status: 500 });
    const out = r.reply(body);
    return new Response(out.json === undefined ? null : JSON.stringify(out.json), { status: out.status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { fetch: fn, calls };
}
