import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { todayIn, WEEKDAYS_FA, faDigits } from '@/lib/dates';
import { getSettings } from '@/lib/services/settings';
import { listTasks } from '@/lib/services/tasks';
import { TaskRow } from '@/components/task-row';
import { Empty } from '@/components/ui';

const FREQ = { daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه', yearly: 'سالانه' } as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ status?: string; category?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const status = sp.status === 'done' ? 'done' : 'open';
  const category = sp.category === 'work' || sp.category === 'personal' ? sp.category : undefined;
  const s = await getSettings(user.id);
  const today = todayIn(s.timezone);
  const [rows, conn] = await Promise.all([
    listTasks(user.id, { status, category }),
    prisma.calendarConnection.findUnique({ where: { userId: user.id }, select: { status: true } }),
  ]);
  const recurring = rows.filter((r) => r.recurrence);
  const single = rows.filter((r) => !r.recurrence);
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ status, category, ...o }).filter(([, v]) => v) as [string, string][]);
    return `/tasks?${p}`;
  };
  const connected = conn?.status === 'active' || conn?.status === 'error';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">کارها</h1>
        <Link href="/tasks/new" className="btn-ghost">+ کار با جزئیات</Link>
      </div>
      <div className="flex flex-wrap gap-2" role="navigation" aria-label="فیلتر">
        <Link className={`chip ${status === 'open' ? 'chip-on' : ''}`} href={q({ status: 'open' })}>باز</Link>
        <Link className={`chip ${status === 'done' ? 'chip-on' : ''}`} href={q({ status: 'done' })}>انجام‌شده</Link>
        <span className="mx-1 w-px bg-line" />
        <Link className={`chip ${!category ? 'chip-on' : ''}`} href={q({ category: undefined })}>همه</Link>
        <Link className={`chip ${category === 'work' ? 'chip-on' : ''}`} href={q({ category: 'work' })}>کاری</Link>
        <Link className={`chip ${category === 'personal' ? 'chip-on' : ''}`} href={q({ category: 'personal' })}>شخصی</Link>
      </div>

      {single.length === 0 && recurring.length === 0 && <Empty>{status === 'done' ? 'هنوز کاری انجام نشده.' : 'کار بازی ندارید.'}</Empty>}

      {single.length > 0 && (
        <ul className="space-y-2">
          {single.map(({ item }) => (
            <TaskRow key={item.key} item={item} today={today} tz={s.timezone} calendarConnected={connected} showDate />
          ))}
        </ul>
      )}

      {recurring.length > 0 && (
        <section>
          <h2 className="section-title">تکرارشونده‌ها</h2>
          <ul className="space-y-2">
            {recurring.map(({ item, recurrence: r }) => (
              <li key={item.taskId} className="card flex items-center justify-between gap-3 p-3">
                <Link href={`/tasks/${item.taskId}`} className="font-medium">{item.title}</Link>
                <span className="text-xs text-muted">
                  ↻ {r!.interval > 1 ? `هر ${faDigits(r!.interval)} ` : ''}
                  {FREQ[r!.freq]}
                  {r!.freq === 'weekly' && r!.weekdays.length ? ` (${r!.weekdays.map((d) => WEEKDAYS_FA[d]).join('، ')})` : ''}
                  {r!.time ? ` · ${faDigits(r!.time)}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
