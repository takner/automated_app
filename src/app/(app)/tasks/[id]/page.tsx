import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isLocalDate, todayIn, formatDate } from '@/lib/dates';
import { getSettings } from '@/lib/services/settings';
import { occurrenceItems } from '@/lib/services/tasks';
import { TaskForm } from '@/components/task-form';

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ occ?: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const { occ } = await searchParams;
  const s = await getSettings(user.id);
  const today = todayIn(s.timezone);
  const isNew = id === 'new';
  const task = isNew ? null : await prisma.task.findFirst({ where: { id, userId: user.id }, include: { recurrence: true, occurrences: true } });
  if (!isNew && !task) notFound();
  const links = task ? await prisma.calendarEventLink.count({ where: { taskId: task.id } }) : 0;

  let occurrence = null;
  if (task?.recurrence && occ && isLocalDate(occ)) {
    const row = task.occurrences.find((o) => o.date === occ);
    const item = occurrenceItems(task, occ, occ, today)[0] ?? occurrenceItems(task, row?.movedToDate ?? occ, row?.movedToDate ?? occ, today).find((i) => i.occurrenceDate === occ);
    occurrence = { date: occ, title: row?.overrideTitle ?? null, start: item?.start ?? null, durationMinutes: row?.overrideDuration ?? null, status: item?.status ?? 'todo' };
  }

  const value = task
    ? {
        id: task.id,
        title: task.title,
        description: task.description,
        category: task.category,
        priority: task.priority,
        energy: task.energy,
        dueDate: task.dueDate,
        dueTime: task.dueTime,
        scheduledStart: task.scheduledStart?.toISOString() ?? null,
        durationMinutes: task.durationMinutes,
        reminderOffsets: task.reminderOffsets,
        reminderAnchor: task.reminderAnchor,
        timezone: task.timezone,
        status: task.status,
        recurrence: task.recurrence
          ? {
              freq: task.recurrence.freq,
              interval: task.recurrence.interval,
              weekdays: task.recurrence.weekdays,
              calendar: task.recurrence.calendar,
              startDate: task.recurrence.startDate,
              untilDate: task.recurrence.untilDate,
              time: task.recurrence.time,
              monthEndPolicy: task.recurrence.monthEndPolicy,
            }
          : null,
      }
    : {
        title: '', description: null, category: 'personal' as const, priority: 'medium' as const, energy: null, dueDate: null, dueTime: null,
        scheduledStart: null, durationMinutes: null, reminderOffsets: [], reminderAnchor: 'start' as const, timezone: s.timezone, status: 'todo' as const, recurrence: null,
      };

  return (
    <div className="space-y-4">
      <Link href="/tasks" className="text-sm text-muted">→ بازگشت به کارها</Link>
      <h1 className="text-xl font-bold">
        {isNew ? 'کار جدید' : occurrence ? `نوبت ${formatDate(occurrence.date, { weekday: true, year: false })}` : 'ویرایش کار'}
      </h1>
      {task?.status === 'done' && <p className="rounded-xl bg-accent-soft px-3 py-2 text-sm text-accent">این کار انجام شده است.</p>}
      <TaskForm task={value} today={today} occurrence={occurrence} calendarLinked={links > 0} />
    </div>
  );
}
