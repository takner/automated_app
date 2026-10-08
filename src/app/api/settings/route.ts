import { z } from 'zod';
import { HttpError, readJson, route } from '@/lib/api';
import { prisma } from '@/lib/db';
import { isTimeOfDay, isValidTimeZone } from '@/lib/dates';
import { getSettings } from '@/lib/services/settings';
import { resyncUser } from '@/lib/notifications/sync';

const time = z.string().refine(isTimeOfDay, 'ساعت نامعتبر');
const body = z
  .object({
    timezone: z.string().refine(isValidTimeZone, 'منطقهٔ زمانی نامعتبر'),
    workDays: z.array(z.number().int().min(1).max(7)).max(7),
    workStart: time,
    workEnd: time,
    sleepStart: time,
    sleepEnd: time,
    minRestMinutes: z.number().int().min(0).max(600),
    minFunMinutes: z.number().int().min(0).max(600),
    focusBlockMinutes: z.number().int().min(25).max(300),
    breakMinutes: z.number().int().min(5).max(60),
    notificationsEnabled: z.boolean(),
    quietStart: time.nullable(),
    quietEnd: time.nullable(),
    notificationPreview: z.boolean(),
    dateReminderTime: time,
  })
  .partial();

export const GET = route(async (_req, { user }) => ({ settings: await getSettings(user.id) }));

export const PUT = route(async (req, { user }) => {
  const patch = body.parse(await readJson(req));
  const cur = await getSettings(user.id);
  const merged = { ...cur, ...patch };
  if (merged.workStart >= merged.workEnd) throw new HttpError(400, 'پایان ساعت کاری باید بعد از شروع آن باشد');
  const settings = await prisma.userSettings.update({ where: { userId: user.id }, data: patch });
  // timezone / reminder-time changes move existing reminders
  if (patch.timezone || patch.dateReminderTime) {
    if (patch.timezone) await prisma.task.updateMany({ where: { userId: user.id }, data: { timezone: patch.timezone } });
    await resyncUser(user.id);
  }
  return { settings };
});
