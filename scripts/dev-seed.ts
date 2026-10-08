// Development-only sample data. Refuses to run in production.
//   DEV_OWNER_EMAIL / DEV_OWNER_PASSWORD come from the local, git-ignored .env
import { prisma } from '../src/lib/db';
import { hashPassword } from '../src/lib/crypto';
import { addDays, todayIn, toJalali } from '../src/lib/dates';
import { createTask } from '../src/lib/services/tasks';
import { createBirthday, createDeadline } from '../src/lib/services/dates-service';

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('dev-seed must not run in production');
  const email = process.env.DEV_OWNER_EMAIL;
  const password = process.env.DEV_OWNER_PASSWORD;
  if (!email || !password) throw new Error('DEV_OWNER_EMAIL and DEV_OWNER_PASSWORD are required');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) await prisma.user.delete({ where: { id: existing.id } });
  const user = await prisma.user.create({ data: { email, name: 'مالک (توسعه)', passwordHash: await hashPassword(password), settings: { create: {} } } });
  const today = todayIn('Asia/Tehran');
  await createTask(user.id, { title: 'جلسهٔ هفتگی تیم', category: 'work', priority: 'high', scheduledDate: today, scheduledTime: '10:00', durationMinutes: 60, reminderOffsets: [15] });
  await createTask(user.id, { title: 'نوشتن گزارش ماهانه', category: 'work', priority: 'high', dueDate: today, durationMinutes: 90 });
  await createTask(user.id, { title: 'بررسی ایمیل‌ها', category: 'work', durationMinutes: 30, dueDate: today, energy: 'low' });
  await createTask(user.id, { title: 'خرید میوه', category: 'personal', durationMinutes: 30 });
  await createTask(user.id, { title: 'تماس با بانک', category: 'personal', dueDate: addDays(today, -1) });
  await createTask(user.id, { title: 'ورزش', category: 'personal', durationMinutes: 45, recurrence: { freq: 'weekly', weekdays: [6, 1, 3], startDate: addDays(today, -14), time: '19:00' }, reminderOffsets: [30] });
  await createTask(user.id, { title: 'کتاب خواندن', category: 'personal', priority: 'low', durationMinutes: 30, recurrence: { freq: 'daily', startDate: addDays(today, -3) } });
  await createDeadline(user.id, { title: 'بیمهٔ بدنهٔ ماشین', kind: 'insurance', dueDate: addDays(today, 26), reminderDays: [30, 7, 1] });
  await createDeadline(user.id, { title: 'تمدید گواهینامه', dueDate: addDays(today, 90) });
  const bd = toJalali(addDays(today, 5));
  await createBirthday(user.id, { name: 'سارا', calendar: 'jalali', month: bd.m, day: bd.d, year: 1370, notes: 'کتاب شعر' });
  await createBirthday(user.id, { name: 'علی', calendar: 'jalali', month: 12, day: 30, reminderDays: [0, 7] });
  await createBirthday(user.id, { name: 'Emma', calendar: 'gregorian', month: 2, day: 29 });
  console.log('dev data seeded for', email);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
