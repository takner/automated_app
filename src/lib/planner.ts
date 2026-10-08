// Rule-based daily planner. Deterministic and explainable: every placed block carries a short
// reason, every task that does not fit carries the reason it did not fit.
//
// Invariants (covered by tests):
// - nothing overlaps a fixed interval (calendar events, fixed blocks, already-scheduled tasks)
// - fun time is reserved before tasks are placed, so more work never removes it
// - rest (breaks + rest blocks) never drops below minRestMinutes because of tasks
// - tasks without an estimated duration are never placed with a made-up duration
import {
  addDays,
  diffDays,
  faDigits,
  minutesOfDay,
  timeFromMinutes,
  weekday,
  zonedToUtc,
  utcToLocal,
  type LocalDate,
} from './dates';

export type Level = 'low' | 'medium' | 'high';

export interface PlannerSettings {
  workDays: number[];
  workStart: string;
  workEnd: string;
  sleepStart: string;
  sleepEnd: string;
  minRestMinutes: number;
  minFunMinutes: number;
  focusBlockMinutes: number;
  breakMinutes: number;
}

export interface FixedItem {
  title: string;
  start: Date;
  end: Date;
  kind: 'event' | 'block' | 'task';
  blockKind?: string; // personal | rest | fun for fixed blocks
}

export interface PlanTask {
  key: string; // taskId or taskId@occurrenceDate
  taskId: string;
  occurrenceDate?: string;
  title: string;
  category: 'personal' | 'work';
  priority: Level;
  energy?: Level | null;
  durationMinutes?: number | null;
  dueDate?: LocalDate | null;
  overdue: boolean;
}

export interface PlannerInput {
  date: LocalDate;
  tz: string;
  now?: Date;
  settings: PlannerSettings;
  energy: Level;
  fixed: FixedItem[];
  tasks: PlanTask[];
}

export type BlockKind = 'task' | 'break' | 'rest' | 'fun' | 'fixed';

export interface PlanBlock {
  kind: BlockKind;
  start: string; // ISO instant
  end: string;
  title: string;
  taskKey?: string;
  reason: string;
}

export interface Unscheduled {
  taskKey: string;
  title: string;
  reason: string;
}

export interface PlanResult {
  date: LocalDate;
  blocks: PlanBlock[];
  unscheduled: Unscheduled[];
  topPriorities: string[];
  summary: {
    workMinutes: number;
    personalTaskMinutes: number;
    restMinutes: number;
    funMinutes: number;
    fixedMinutes: number;
    freeMinutes: number;
    requestedMinutes: number;
  };
  warnings: string[];
}

type Iv = { s: number; e: number };
type Placed = Iv & { kind: BlockKind; title: string; taskKey?: string; reason: string };

const STEP = 5;

function merge(ivs: Iv[]): Iv[] {
  const sorted = ivs.filter((i) => i.e > i.s).sort((a, b) => a.s - b.s);
  const out: Iv[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.s <= last.e) last.e = Math.max(last.e, iv.e);
    else out.push({ ...iv });
  }
  return out;
}

function subtract(base: Iv[], cut: Iv[]): Iv[] {
  let res = base.map((b) => ({ ...b }));
  for (const c of merge(cut)) {
    const next: Iv[] = [];
    for (const r of res) {
      if (c.e <= r.s || c.s >= r.e) next.push(r);
      else {
        if (c.s > r.s) next.push({ s: r.s, e: c.s });
        if (c.e < r.e) next.push({ s: c.e, e: r.e });
      }
    }
    res = next;
  }
  return res.filter((r) => r.e - r.s > 0);
}

function intersect(a: Iv[], b: Iv[]): Iv[] {
  const out: Iv[] = [];
  for (const x of a) for (const y of b) {
    const s = Math.max(x.s, y.s);
    const e = Math.min(x.e, y.e);
    if (e > s) out.push({ s, e });
  }
  return merge(out);
}

const total = (ivs: Iv[]) => ivs.reduce((n, i) => n + (i.e - i.s), 0);

export function scoreTask(t: PlanTask, today: LocalDate, energy: Level): { score: number; reasons: string[] } {
  let score = 0;
  const reasons: string[] = [];
  if (t.overdue) {
    score += 100;
    reasons.push('عقب‌افتاده');
  }
  if (t.dueDate) {
    const days = diffDays(t.dueDate, today);
    if (days <= 0 && !t.overdue) {
      score += 80;
      reasons.push('موعد امروز');
    } else if (days === 1) {
      score += 40;
      reasons.push('موعد فردا');
    } else if (days > 1 && days <= 7) {
      score += 20 - days * 2;
      reasons.push(`موعد ${faDigits(days)} روز دیگر`);
    }
  }
  if (t.priority === 'high') {
    score += 30;
    reasons.push('اهمیت زیاد');
  } else if (t.priority === 'medium') score += 15;
  if (t.energy === 'high' && energy === 'low') {
    score -= 25;
    reasons.push('انرژی امروز برای این کار کم است');
  } else if (t.energy === 'low' && energy === 'low') {
    score += 5;
    reasons.push('مناسب انرژی کم امروز');
  } else if (t.energy === 'high' && energy === 'high') {
    score += 5;
  }
  return { score, reasons };
}

export function planDay(input: PlannerInput): PlanResult {
  const { date, tz, settings: st } = input;
  const toMin = (d: Date): number => {
    const l = utcToLocal(d, tz);
    const delta = diffDays(l.date, date);
    return delta * 1440 + minutesOfDay(l.time);
  };
  const toInstant = (m: number): string => {
    const dayOffset = Math.floor(m / 1440);
    return zonedToUtc(addDays(date, dayOffset), timeFromMinutes(m), tz).toISOString();
  };

  // ── day window ──
  let dayStart = minutesOfDay(st.sleepEnd);
  let dayEnd = minutesOfDay(st.sleepStart);
  if (dayEnd <= dayStart) dayEnd = 1440; // sleeping after midnight: plan until the day ends
  if (input.now) {
    const nowMin = toMin(input.now);
    if (nowMin > dayStart) dayStart = Math.ceil(nowMin / STEP) * STEP;
  }
  const warnings: string[] = [];
  const blocks: Placed[] = [];
  const unscheduled: Unscheduled[] = [];

  const fixedIvs: Iv[] = [];
  for (const f of input.fixed) {
    const s = Math.max(toMin(f.start), 0);
    const e = Math.min(toMin(f.end), 1440);
    if (e <= s) continue;
    fixedIvs.push({ s, e });
    const kind: BlockKind = f.blockKind === 'rest' ? 'rest' : f.blockKind === 'fun' ? 'fun' : 'fixed';
    blocks.push({
      s, e, kind, title: f.title,
      reason: f.kind === 'event' ? 'قرار تقویم' : f.kind === 'task' ? 'زمان‌بندی‌شده توسط شما' : 'زمان ثابت',
    });
  }

  const window: Iv[] = dayStart < dayEnd ? [{ s: dayStart, e: dayEnd }] : [];
  let free = subtract(window, fixedIvs);
  const freeBefore = total(free);

  const isWorkDay = st.workDays.includes(weekday(date));
  const workIv: Iv[] = isWorkDay ? [{ s: minutesOfDay(st.workStart), e: minutesOfDay(st.workEnd) }] : [];
  const fixedFun = blocks.filter((b) => b.kind === 'fun').reduce((n, b) => n + (b.e - b.s), 0);
  const fixedRest = blocks.filter((b) => b.kind === 'rest').reduce((n, b) => n + (b.e - b.s), 0);

  const take = (iv: Iv) => {
    free = subtract(free, [iv]);
  };

  // ── reserve fun (evening first) ──
  let funNeeded = Math.max(0, st.minFunMinutes - fixedFun);
  if (funNeeded > 0) {
    const eveningStart = isWorkDay ? minutesOfDay(st.workEnd) : 17 * 60;
    const evening = intersect(free, [{ s: eveningStart, e: 1440 }]);
    let slot = evening.find((f) => f.e - f.s >= funNeeded) ?? free.filter((f) => f.e - f.s >= funNeeded).sort((a, b) => b.s - a.s)[0];
    if (slot) {
      const iv = { s: slot.s, e: slot.s + funNeeded };
      blocks.push({ ...iv, kind: 'fun', title: 'تفریح', reason: 'حداقل زمان تفریح روزانه — با زیاد شدن کار حذف نمی‌شود' });
      take(iv);
      funNeeded = 0;
    } else {
      // fragmented day: use the largest piece and say so
      const biggest = [...free].sort((a, b) => b.e - b.s - (a.e - a.s))[0];
      if (biggest && biggest.e - biggest.s >= 15) {
        const len = Math.min(funNeeded, biggest.e - biggest.s);
        const iv = { s: biggest.s, e: biggest.s + len };
        blocks.push({ ...iv, kind: 'fun', title: 'تفریح', reason: 'بخشی از زمان تفریح؛ روز پر از قرار ثابت است' });
        take(iv);
        funNeeded -= len;
      }
      if (funNeeded > 0) warnings.push(`قرارهای ثابت امروز جای ${faDigits(funNeeded)} دقیقه از تفریح را گرفته‌اند.`);
    }
  }

  // rest still owed after fixed rest blocks; breaks between tasks count towards it
  let restOwed = Math.max(0, st.minRestMinutes - fixedRest);

  // ── tasks ──
  const scored = input.tasks.map((t) => ({ t, ...scoreTask(t, date, input.energy) }));
  scored.sort((a, b) => b.score - a.score || (a.t.durationMinutes ?? 1e9) - (b.t.durationMinutes ?? 1e9));
  const topPriorities = scored.slice(0, 3).map((x) => x.t.key);

  const taskBlocks = () => blocks.filter((b) => b.kind === 'task').sort((a, b) => a.s - b.s);
  /** Minutes of uninterrupted task work ending exactly at m. */
  const runEndingAt = (m: number): number => {
    let run = 0;
    let cursor = m;
    for (const b of [...taskBlocks()].reverse()) {
      if (b.e === cursor) {
        run += b.e - b.s;
        cursor = b.s;
      } else if (b.e < cursor) break;
    }
    return run;
  };

  let requested = 0;
  for (const { t, reasons } of scored) {
    if (!t.durationMinutes || t.durationMinutes <= 0) {
      unscheduled.push({ taskKey: t.key, title: t.title, reason: 'مدت تخمینی ندارد؛ برای برنامه‌ریزی، مدت را وارد کنید' });
      continue;
    }
    const dur = t.durationMinutes;
    requested += dur;
    const urgent = t.overdue || (t.dueDate != null && t.dueDate <= date);
    let allowed: Iv[];
    let where: string;
    if (t.category === 'work') {
      if (isWorkDay) {
        allowed = intersect(free, workIv);
        where = 'در ساعت کاری';
      } else if (urgent) {
        allowed = free;
        where = 'روز تعطیل، ولی موعدش رسیده';
      } else {
        unscheduled.push({ taskKey: t.key, title: t.title, reason: 'امروز روز کاری شما نیست' });
        continue;
      }
    } else {
      allowed = isWorkDay ? subtract(free, workIv) : free;
      where = isWorkDay ? 'خارج از ساعت کاری' : '';
      if (urgent && !allowed.some((a) => a.e - a.s >= dur)) {
        allowed = free;
        where = 'موعدش رسیده؛ در زمان آزاد';
      }
    }

    let placed = false;
    let sawLongEnough = false;
    let blockedByRest = false;
    for (const slot of allowed) {
      for (let s = slot.s; s + dur <= slot.e; s += STEP) {
        sawLongEnough = true;
        const run = runEndingAt(s);
        let start = s;
        let breakIv: Iv | null = null;
        if (run > 0 && run + dur > st.focusBlockMinutes) {
          breakIv = { s, e: s + st.breakMinutes };
          start = breakIv.e;
          if (start + dur > slot.e) continue;
        }
        const iv = { s: start, e: start + dur };
        const consumes = dur + (breakIv ? st.breakMinutes : 0);
        const restAfter = Math.max(0, restOwed - (breakIv ? st.breakMinutes : 0));
        if (total(free) - consumes < restAfter) {
          blockedByRest = true; // would eat into protected rest
          break;
        }
        if (breakIv) {
          blocks.push({ ...breakIv, kind: 'break', title: 'استراحت کوتاه', reason: `بعد از ${faDigits(run)} دقیقه کار پیوسته` });
          take(breakIv);
          restOwed = restAfter;
        }
        blocks.push({
          ...iv,
          kind: 'task',
          title: t.title,
          taskKey: t.key,
          reason: [...reasons, where].filter(Boolean).join(' • ') || 'زمان آزاد مناسب',
        });
        take(iv);
        placed = true;
        break;
      }
      if (placed) break;
    }
    if (!placed) {
      let reason: string;
      if (total(allowed) < dur) reason = 'ظرفیت کافی در زمان مجاز امروز نمانده';
      else if (blockedByRest) reason = 'جای خالی باقی‌مانده برای حفظ حداقل استراحت لازم است';
      else if (!sawLongEnough) reason = `بازهٔ آزاد پیوستهٔ ${faDigits(dur)} دقیقه‌ای پیدا نشد`;
      else reason = 'با احتساب استراحت بین کارها جا نشد';
      unscheduled.push({ taskKey: t.key, title: t.title, reason });
    }
  }

  // ── remaining protected rest ──
  if (restOwed > 0) {
    // prefer a slot near midday, then any free time
    const sorted = [...free].sort((a, b) => Math.abs(a.s - 13 * 60) - Math.abs(b.s - 13 * 60));
    for (const f of sorted) {
      if (restOwed <= 0) break;
      const len = Math.min(restOwed, f.e - f.s);
      if (len < STEP) continue;
      const iv = { s: f.s, e: f.s + len };
      blocks.push({ ...iv, kind: 'rest', title: 'استراحت', reason: 'حداقل استراحت روزانه' });
      take(iv);
      restOwed -= len;
    }
    if (restOwed > 0) warnings.push(`قرارهای ثابت امروز جای ${faDigits(restOwed)} دقیقه از استراحت را گرفته‌اند.`);
  }

  if (freeBefore === 0 && window.length) warnings.push('امروز زمان آزادی باقی نمانده است.');

  blocks.sort((a, b) => a.s - b.s);
  const sum = (k: BlockKind) => blocks.filter((b) => b.kind === k).reduce((n, b) => n + (b.e - b.s), 0);
  const taskMinutes = (cat: 'work' | 'personal') =>
    blocks
      .filter((b) => b.kind === 'task' && input.tasks.find((t) => t.key === b.taskKey)?.category === cat)
      .reduce((n, b) => n + (b.e - b.s), 0);

  return {
    date,
    blocks: blocks.map((b) => ({
      kind: b.kind,
      start: toInstant(b.s),
      end: toInstant(b.e),
      title: b.title,
      taskKey: b.taskKey,
      reason: b.reason,
    })),
    unscheduled,
    topPriorities,
    summary: {
      workMinutes: taskMinutes('work'),
      personalTaskMinutes: taskMinutes('personal'),
      restMinutes: sum('rest') + sum('break'),
      funMinutes: sum('fun'),
      fixedMinutes: sum('fixed'),
      freeMinutes: total(free),
      requestedMinutes: requested,
    },
    warnings,
  };
}
