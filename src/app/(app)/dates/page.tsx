import { requireUser } from '@/lib/auth';
import { listDates } from '@/lib/services/dates-service';
import { DatesView } from '@/components/dates-view';

export default async function DatesPage() {
  const user = await requireUser();
  const d = await listDates(user.id);
  return (
    <DatesView
      today={d.today}
      birthdays={d.birthdays}
      deadlines={d.deadlines.map((x) => ({
        id: x.id,
        title: x.title,
        kind: x.kind,
        dueDate: x.dueDate,
        notes: x.notes,
        reminderDays: x.reminderDays,
        archived: x.archived,
        daysUntil: x.daysUntil,
        renewals: x.renewals.map((r) => ({ id: r.id, previousDueDate: r.previousDueDate, newDueDate: r.newDueDate, note: r.note, renewedAt: r.renewedAt.toISOString() })),
      }))}
    />
  );
}
