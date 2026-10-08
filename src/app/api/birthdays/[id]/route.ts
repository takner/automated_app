import { readJson, route } from '@/lib/api';
import { deleteBirthday, updateBirthday } from '@/lib/services/dates-service';

export const PATCH = route<{ id: string }>(async (req, { user, params }) => ({ birthday: await updateBirthday(user.id, params.id, await readJson(req)) }));

export const DELETE = route<{ id: string }>(async (_req, { user, params }) => {
  await deleteBirthday(user.id, params.id);
  return { ok: true };
});
