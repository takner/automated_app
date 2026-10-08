import { readJson, route } from '@/lib/api';
import { deleteTask, getOwnedTask, updateTask } from '@/lib/services/tasks';
import { removeFromCalendar } from '@/lib/google/calendar';
import { prisma } from '@/lib/db';

export const GET = route<{ id: string }>(async (_req, { user, params }) => {
  const task = await getOwnedTask(user.id, params.id);
  const links = await prisma.calendarEventLink.findMany({ where: { taskId: task.id } });
  return { task, calendarLinks: links.map((l) => l.occurrenceDate) };
});

export const PATCH = route<{ id: string }>(async (req, { user, params }) => {
  return { task: await updateTask(user.id, params.id, await readJson(req)) };
});

export const DELETE = route<{ id: string }>(async (req, { user, params }) => {
  await getOwnedTask(user.id, params.id);
  // only on explicit request, and only events this app created
  if (req.nextUrl.searchParams.get('removeEvents') === '1') await removeFromCalendar(user.id, params.id, null);
  await deleteTask(user.id, params.id);
  return { ok: true };
});
