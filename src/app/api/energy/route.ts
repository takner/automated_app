import { z } from 'zod';
import { readJson, route } from '@/lib/api';
import { isLocalDate } from '@/lib/dates';
import { setEnergy } from '@/lib/services/plan-service';

const body = z.object({ date: z.string().refine(isLocalDate), energy: z.enum(['low', 'medium', 'high']) });

export const POST = route(async (req, { user }) => {
  const b = body.parse(await readJson(req));
  await setEnergy(user.id, b.date, b.energy);
  return { ok: true };
});
