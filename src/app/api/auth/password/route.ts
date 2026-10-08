import { z } from 'zod';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/crypto';
import { HttpError, readJson, route } from '@/lib/api';
import { rateLimit } from '@/lib/rate-limit';

const body = z.object({ current: z.string().max(200), next: z.string().min(12, 'رمز جدید حداقل ۱۲ نویسه باشد').max(200) });

export const POST = route(async (req, { user }) => {
  if (!rateLimit(`pw:${user.id}`, 5, 15 * 60_000).ok) throw new HttpError(429, 'تلاش زیاد بود؛ بعداً امتحان کنید', 'rate_limited');
  const { current, next } = body.parse(await readJson(req));
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  if (row.passwordHash && !(await verifyPassword(current, row.passwordHash))) throw new HttpError(400, 'رمز فعلی درست نیست');
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next) } });
  // sign out every other session
  await prisma.session.deleteMany({ where: { userId: user.id, id: { not: user.sessionId } } });
  return { ok: true };
});
