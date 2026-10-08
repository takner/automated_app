// Quick actions on a Today item (one-off task "id" or occurrence "id@YYYY-MM-DD").
import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { addDays, isLocalDate, isTimeOfDay, todayIn, zonedToUtc } from '@/lib/dates';
import { getOwnedTask, moveItem, parseKey, setItemStatus } from '@/lib/services/tasks';
import { getSettings } from '@/lib/services/settings';
import { pushToCalendar, removeFromCalendar } from '@/lib/google/calendar';

const moveBody = z.object({
  date: z.string().refine(isLocalDate),
  time: z.string().refine(isTimeOfDay).nullish(),
});
const snoozeBody = z.object({ minutes: z.number().int().min(5).max(7 * 24 * 60).optional(), tomorrowAt: z.string().refine(isTimeOfDay).optional() });

export const POST = route<{ key: string; action: string }>(async (req, { user, params }) => {
  const key = decodeURIComponent(params.key);
  switch (params.action) {
    case 'done':
      await setItemStatus(user.id, key, 'done');
      return { ok: true };
    case 'undo':
      await setItemStatus(user.id, key, 'todo');
      return { ok: true };
    case 'skip':
      await setItemStatus(user.id, key, 'skipped');
      return { ok: true };
    case 'move': {
      const b = moveBody.parse(await readJson(req));
      await moveItem(user.id, key, b.date, b.time ?? null);
      return { ok: true };
    }
    case 'snooze': {
      // «بعداً یادآوری کن»: a one-off reminder; the task's own schedule is not changed
      const b = snoozeBody.parse(await readJson(req));
      const { taskId, occ } = parseKey(key);
      const task = await getOwnedTask(user.id, taskId);
      const s = await getSettings(user.id);
      const fireAt = b.tomorrowAt
        ? zonedToUtc(addDays(todayIn(s.timezone), 1), b.tomorrowAt, s.timezone)
        : new Date(Date.now() + (b.minutes ?? 60) * 60_000);
      const title = occ ? (task.occurrences.find((o) => o.date === occ)?.overrideTitle ?? task.title) : task.title;
      await prisma.notification.create({
        data: {
          userId: user.id,
          sourceType: 'snooze',
          sourceId: taskId,
          dedupeKey: `snooze:${taskId}:${occ ?? ''}:${fireAt.toISOString()}`,
          fireAt,
          nextAttemptAt: fireAt,
          title: `یادآوری: ${title}`,
          body: 'خواسته بودید دوباره یادآوری شود.',
          url: `/tasks/${taskId}${occ ? `?occ=${occ}` : ''}`,
        },
      });
      return { ok: true, fireAt: fireAt.toISOString() };
    }
    case 'calendar': {
      return pushToCalendar(user.id, key);
    }
    case 'uncalendar': {
      const { taskId, occ } = parseKey(key);
      await getOwnedTask(user.id, taskId);
      return removeFromCalendar(user.id, taskId, occ ?? '');
    }
    default:
      throw new HttpError(404, 'عملیات ناشناخته');
  }
});
