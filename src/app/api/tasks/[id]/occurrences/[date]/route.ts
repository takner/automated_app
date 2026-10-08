import { readJson, route } from '@/lib/api';
import { updateOccurrence } from '@/lib/services/tasks';

/** Edit only this occurrence; the series is unchanged. */
export const PATCH = route<{ id: string; date: string }>(async (req, { user, params }) => {
  await updateOccurrence(user.id, params.id, params.date, await readJson(req));
  return { ok: true };
});
