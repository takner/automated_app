import { z } from 'zod';
import { prisma } from '@/lib/db';
import { createSession } from '@/lib/auth';
import { verifyPassword } from '@/lib/crypto';
import { HttpError, clientIp, publicRoute, readJson } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';
import { log } from '@/lib/log';

const body = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(1).max(200) });

export const POST = publicRoute(async (req) => {
  const { email, password } = body.parse(await readJson(req));
  const ip = clientIp(req);
  for (const key of [`login:ip:${ip}`, `login:email:${email}`]) {
    const r = rateLimit(key, 8, 15 * 60_000);
    if (!r.ok) throw new HttpError(429, `تلاش زیاد بود؛ ${Math.ceil(r.retryAfterSec / 60)} دقیقهٔ دیگر امتحان کنید.`, 'rate_limited');
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) {
    log.warn('login failed', { ip });
    throw new HttpError(401, 'ایمیل یا رمز عبور درست نیست', 'bad_credentials');
  }
  await createSession(user.id);
  return { ok: true };
});
