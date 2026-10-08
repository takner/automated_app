import { describe, expect, it } from 'vitest';
import { planDay, type PlannerInput, type PlanTask } from '@/lib/planner';
import { zonedToUtc } from '@/lib/dates';

const TZ = 'Asia/Tehran';
const DATE = '2026-10-10'; // Saturday — a work day by default
const at = (t: string, d = DATE) => zonedToUtc(d, t, TZ);

const settings = {
  workDays: [6, 7, 1, 2, 3],
  workStart: '09:00',
  workEnd: '17:00',
  sleepStart: '23:30',
  sleepEnd: '07:30',
  minRestMinutes: 45,
  minFunMinutes: 60,
  focusBlockMinutes: 90,
  breakMinutes: 15,
};

function task(over: Partial<PlanTask> & { key: string }): PlanTask {
  return {
    taskId: over.key,
    title: over.key,
    category: 'work',
    priority: 'medium',
    durationMinutes: 60,
    overdue: false,
    ...over,
  };
}

function input(over: Partial<PlannerInput>): PlannerInput {
  return { date: DATE, tz: TZ, settings, energy: 'medium', fixed: [], tasks: [], ...over };
}

const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) =>
  new Date(a.start) < new Date(b.end) && new Date(b.start) < new Date(a.end);

describe('planDay', () => {
  it('never overlaps fixed events', () => {
    const fixed = [
      { title: 'جلسه', start: at('09:00'), end: at('11:00'), kind: 'event' as const },
      { title: 'ناهار خانوادگی', start: at('13:00'), end: at('14:00'), kind: 'block' as const },
    ];
    const tasks = Array.from({ length: 6 }, (_, i) => task({ key: `t${i}`, durationMinutes: 50 }));
    const r = planDay(input({ fixed, tasks }));
    const placed = r.blocks.filter((b) => b.kind !== 'fixed');
    for (const p of placed) for (const f of fixed) expect(overlaps(p, { start: f.start.toISOString(), end: f.end.toISOString() })).toBe(false);
    // no two plan blocks overlap each other either
    for (let i = 0; i < r.blocks.length; i++)
      for (let j = i + 1; j < r.blocks.length; j++) expect(overlaps(r.blocks[i], r.blocks[j])).toBe(false);
  });

  it('keeps work tasks inside work hours and personal tasks outside them', () => {
    const r = planDay(input({ tasks: [task({ key: 'w' }), task({ key: 'p', category: 'personal' })] }));
    const w = r.blocks.find((b) => b.taskKey === 'w')!;
    const p = r.blocks.find((b) => b.taskKey === 'p')!;
    expect(new Date(w.start) >= at('09:00') && new Date(w.end) <= at('17:00')).toBe(true);
    expect(new Date(p.start) >= at('17:00') || new Date(p.end) <= at('09:00')).toBe(true);
  });

  it('reports overflow with reasons instead of squeezing tasks in', () => {
    const tasks = Array.from({ length: 12 }, (_, i) => task({ key: `t${i}`, durationMinutes: 60 }));
    const r = planDay(input({ tasks }));
    const placed = r.blocks.filter((b) => b.kind === 'task');
    expect(placed.length).toBeLessThan(12);
    expect(r.unscheduled.length).toBe(12 - placed.length);
    for (const u of r.unscheduled) expect(u.reason.length).toBeGreaterThan(5);
    expect(r.summary.requestedMinutes).toBe(720);
  });

  it('keeps rest and fun when work grows', () => {
    const light = planDay(input({ tasks: [task({ key: 'a' })] }));
    const heavy = planDay(
      input({
        tasks: [
          ...Array.from({ length: 20 }, (_, i) => task({ key: `w${i}`, durationMinutes: 45 })),
          ...Array.from({ length: 20 }, (_, i) => task({ key: `p${i}`, category: 'personal', durationMinutes: 45 })),
        ],
      }),
    );
    for (const r of [light, heavy]) {
      expect(r.summary.funMinutes).toBeGreaterThanOrEqual(60);
      expect(r.summary.restMinutes).toBeGreaterThanOrEqual(45);
    }
    expect(heavy.unscheduled.length).toBeGreaterThan(0);
  });

  it('inserts a break after a long focus run', () => {
    const tasks = [task({ key: 'a', durationMinutes: 60 }), task({ key: 'b', durationMinutes: 60 })];
    const r = planDay(input({ tasks }));
    const a = r.blocks.find((x) => x.taskKey === 'a')!;
    const b = r.blocks.find((x) => x.taskKey === 'b')!;
    const gap = (new Date(b.start).getTime() - new Date(a.end).getTime()) / 60000;
    expect(gap).toBeGreaterThanOrEqual(15);
    expect(r.blocks.some((x) => x.kind === 'break')).toBe(true);
  });

  it('does not invent durations', () => {
    const r = planDay(input({ tasks: [task({ key: 'x', durationMinutes: null })] }));
    expect(r.blocks.some((b) => b.taskKey === 'x')).toBe(false);
    expect(r.unscheduled[0]).toMatchObject({ taskKey: 'x' });
    expect(r.unscheduled[0].reason).toContain('مدت');
  });

  it('prioritises overdue and due-today tasks and explains why', () => {
    const tasks = [
      task({ key: 'later', priority: 'low' }),
      task({ key: 'today', dueDate: DATE }),
      task({ key: 'late', overdue: true, dueDate: '2026-10-08' }),
    ];
    const r = planDay(input({ tasks }));
    expect(r.topPriorities).toEqual(['late', 'today', 'later']);
    expect(r.blocks.find((b) => b.taskKey === 'late')!.reason).toContain('عقب‌افتاده');
  });

  it('does not plan work tasks on a day off unless they are due', () => {
    const friday = '2026-10-09';
    const r = planDay(input({ date: friday, tasks: [task({ key: 'w' }), task({ key: 'urgent', dueDate: friday })] }));
    expect(r.unscheduled.find((u) => u.taskKey === 'w')?.reason).toContain('روز کاری');
    expect(r.blocks.some((b) => b.taskKey === 'urgent')).toBe(true);
  });

  it('starts from now when planning the rest of today', () => {
    const r = planDay(input({ now: at('15:10'), tasks: [task({ key: 'w', durationMinutes: 30 })] }));
    expect(new Date(r.blocks.find((b) => b.taskKey === 'w')!.start) >= at('15:10')).toBe(true);
  });

  it('lowers high-energy tasks when energy is low', () => {
    const tasks = [task({ key: 'hard', energy: 'high' }), task({ key: 'easy', energy: 'low' })];
    expect(planDay(input({ energy: 'low', tasks })).topPriorities[0]).toBe('easy');
    expect(planDay(input({ energy: 'high', tasks })).topPriorities[0]).toBe('hard');
  });
});
