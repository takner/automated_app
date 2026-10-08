import { NextResponse } from 'next/server';
import { HttpError, clientIp, publicRoute } from '@/lib/api';
import { features } from '@/lib/env';
import { buildAuthUrl } from '@/lib/google/oauth';
import { rateLimit } from '@/lib/rate-limit';

export const GET = publicRoute(async (req) => {
  if (!features().googleLogin) throw new HttpError(503, 'ورود با Google پیکربندی نشده است', 'google_not_configured');
  if (!rateLimit(`glogin:${clientIp(req)}`, 10, 15 * 60_000).ok) throw new HttpError(429, 'تلاش زیاد بود', 'rate_limited');
  return NextResponse.redirect(await buildAuthUrl('login', null));
});
