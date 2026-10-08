import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getSettings } from '@/lib/services/settings';
import { dayView } from '@/lib/services/tasks';
import { calendarEventsForDay, computePlan, getEnergy } from '@/lib/services/plan-service';
import { listDates } from '@/lib/services/dates-service';
import { TodayView } from '@/components/today-view';

export default async function TodayPage() {
  const user = await requireUser();
  const s = await getSettings(user.id);
  const now = new Date();
  const view = await dayView(user.id, undefined, now);
  const [plan, events, energy, dates, conn] = await Promise.all([
    computePlan(user.id, view.today, now),
    calendarEventsForDay(user.id, view.today, s.timezone),
    getEnergy(user.id, view.today),
    listDates(user.id),
    prisma.calendarConnection.findUnique({ where: { userId: user.id }, select: { status: true, lastSyncAt: true, lastSyncError: true } }),
  ]);
  return (
    <TodayView
      tz={s.timezone}
      view={view}
      plan={plan}
      energy={energy}
      events={events.map((e) => ({ id: e.id, summary: e.summary, allDay: e.allDay, start: e.start?.toISOString() ?? null, end: e.end?.toISOString() ?? null }))}
      birthdays={dates.birthdays.filter((b) => b.daysUntil != null && b.daysUntil <= 14)}
      deadlines={dates.deadlines.filter((d) => !d.archived && d.daysUntil <= 30).map((d) => ({ id: d.id, title: d.title, dueDate: d.dueDate, daysUntil: d.daysUntil, kind: d.kind }))}
      calendar={conn ? { status: conn.status, lastSyncAt: conn.lastSyncAt?.toISOString() ?? null, error: conn.lastSyncError } : null}
    />
  );
}
