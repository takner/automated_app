import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { acceptPlan } from '@/lib/services/plan-service';

const body = z.object({ keys: z.array(z.string().max(80)).max(100).optional() });

export const POST = route<{ id: string; action: string }>(async (req, { user, params }) => {
  if (params.action === 'accept') {
    const { keys } = body.parse(await readJson(req));
    return acceptPlan(user.id, params.id, keys);
  }
  if (params.action === 'discard') {
    const r = await prisma.dailyPlan.updateMany({ where: { id: params.id, userId: user.id, status: 'draft' }, data: { status: 'discarded' } });
    if (!r.count) throw new HttpError(404, 'پیدا نشد');
    return { ok: true };
  }
  throw new HttpError(404, 'عملیات ناشناخته');
});
