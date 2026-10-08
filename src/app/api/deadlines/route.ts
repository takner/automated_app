import { readJson, route } from '@/lib/api';
import { createDeadline, listDates } from '@/lib/services/dates-service';

export const GET = route(async (_req, { user }) => ({ deadlines: (await listDates(user.id)).deadlines }));

export const POST = route(async (req, { user }) => ({ deadline: await createDeadline(user.id, await readJson(req)) }));
