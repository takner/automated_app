// Route-handler wrapper: authentication, same-origin check for state-changing requests (CSRF),
// zod validation errors → 400, and uniform JSON errors without leaking internals.
import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { getSessionUser, type SessionUser } from './auth';
import { env } from './env';
import { log } from './log';

import { HttpError } from './errors';

export { HttpError, notFound } from './errors';

type Ctx<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: { user: SessionUser; params: P }) => Promise<Response | unknown>;
type PublicHandler<P> = (req: NextRequest, ctx: { user: SessionUser | null; params: P }) => Promise<Response | unknown>;

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get('origin');
  const allowed = new URL(env().APP_URL).origin;
  if (origin) return origin === allowed;
  // Some browsers omit Origin on same-origin requests; fall back to Fetch Metadata.
  const site = req.headers.get('sec-fetch-site');
  return site === 'same-origin';
}

function toResponse(out: unknown): Response {
  if (out instanceof Response) return out;
  return NextResponse.json(out ?? { ok: true });
}

function handleError(err: unknown, req: NextRequest): Response {
  if (err instanceof HttpError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  if (err instanceof ZodError) {
    return NextResponse.json(
      { error: 'ورودی نامعتبر است', code: 'invalid_input', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) },
      { status: 400 },
    );
  }
  log.error('api error', { path: req.nextUrl.pathname, method: req.method, err });
  return NextResponse.json({ error: 'خطای داخلی سرور', code: 'internal' }, { status: 500 });
}

export function route<P = Record<string, never>>(handler: Handler<P>) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      if (!SAFE.has(req.method) && !isSameOrigin(req)) throw new HttpError(403, 'درخواست از مبدأ نامعتبر', 'bad_origin');
      const user = await getSessionUser();
      if (!user) throw new HttpError(401, 'ابتدا وارد شوید', 'unauthenticated');
      return toResponse(await handler(req, { user, params: await ctx.params }));
    } catch (err) {
      return handleError(err, req);
    }
  };
}

export function publicRoute<P = Record<string, never>>(handler: PublicHandler<P>, opts: { csrf?: boolean } = {}) {
  return async (req: NextRequest, ctx: Ctx<P>) => {
    try {
      if (opts.csrf !== false && !SAFE.has(req.method) && !isSameOrigin(req)) throw new HttpError(403, 'درخواست از مبدأ نامعتبر', 'bad_origin');
      const user = await getSessionUser();
      return toResponse(await handler(req, { user, params: await ctx.params }));
    } catch (err) {
      return handleError(err, req);
    }
  };
}

export async function readJson(req: NextRequest): Promise<unknown> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 256 * 1024) throw new HttpError(413, 'درخواست خیلی بزرگ است');
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'JSON نامعتبر');
  }
}

export function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
}
