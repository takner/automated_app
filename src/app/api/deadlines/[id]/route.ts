import { readJson, route } from '@/lib/api';
import { deleteDeadline, renewDeadline, updateDeadline } from '@/lib/services/dates-service';

export const PATCH = route<{ id: string }>(async (req, { user, params }) => ({ deadline: await updateDeadline(user.id, params.id, await readJson(req)) }));

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await deleteDeadline(user.id, params.id);
  return { ok: true };
});

/** «تمدید شد» */
export const POST = route<{ id: string }>(async (req, { user, params }) => ({ deadline: await renewDeadline(user.id, params.id, await readJson(req)) }));
