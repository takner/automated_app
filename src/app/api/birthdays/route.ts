import { readJson, route } from '@/lib/api';
import { createBirthday, listDates } from '@/lib/services/dates-service';

export const GET = route(async (_req, { user }) => ({ birthdays: (await listDates(user.id)).birthdays }));

export const POST = route(async (req, { user }) => ({ birthday: await createBirthday(user.id, await readJson(req)) }));
