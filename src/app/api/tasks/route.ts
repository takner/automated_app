import { z } from 'zod';
import { readJson, route } from '@/lib/api';
import { createTask, listTasks } from '@/lib/services/tasks';

const filter = z.object({ status: z.enum(['open', 'done']).optional(), category: z.enum(['personal', 'work']).optional() });

export const GET = route(async (req, { user }) => {
  const f = filter.parse(Object.fromEntries(req.nextUrl.searchParams));
  return { tasks: await listTasks(user.id, f) };
});

export const POST = route(async (req, { user }) => {
  const task = await createTask(user.id, await readJson(req));
  return { task };
});
