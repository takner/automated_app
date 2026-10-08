import { z } from 'zod';
import { readJson, route } from '@/lib/api';
import { isLocalDate } from '@/lib/dates';
import { createDraft } from '@/lib/services/plan-service';

const body = z.object({ date: z.string().refine(isLocalDate).optional() });

/** Build a new plan proposal (draft). Nothing changes until it is accepted. */
export const POST = route(async (req, { user }) => {
  const { date } = body.parse(await readJson(req));
  return { plan: await createDraft(user.id, date) };
});
