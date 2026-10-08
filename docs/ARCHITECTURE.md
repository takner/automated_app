# Hamrooz (هم‌روز) — architecture

A single-owner Persian PWA for personal and work tasks, birthdays, renewals (e.g. car
insurance), a realistic daily plan that protects rest and fun time, Google Calendar,
voice capture and Web Push reminders.

## Components

```
Browser (PWA, RTL)              Server (Docker Compose, project "hamrooz")
┌──────────────────┐   HTTPS    ┌──────────┐   ┌──────────────────────────┐
│ Next.js UI       │──Traefik──▶│ web      │──▶│ PostgreSQL 16 (db)       │
│ service worker   │            │ Next 16  │   │ internal network only    │
│ (push, offline)  │◀── push ───┤          │   └──────────────────────────┘
└──────────────────┘   (FCM/    └──────────┘          ▲         ▲
                        APNs/…)  ┌──────────┐          │         │
                          ▲      │ worker   │──────────┘   ┌─────┴────┐
                          └──────┤ Node     │              │ backup   │ pg_dump daily,
                                 └──────────┘              └──────────┘ 14-day retention
   External (optional, server-side keys only): Google OAuth/Calendar, OpenAI STT, Anthropic.
```

- **web** — Next.js 16 (App Router) + TypeScript. Server components read through the service
  layer; mutations go through JSON route handlers under `/api` (zod-validated, owner-scoped).
- **worker** — `src/worker/main.ts` bundled to `dist/worker.mjs`. Every 20 s it delivers due
  reminders; every 10 min it rolls recurring/birthday reminder horizons forward; every 15 min
  it syncs Google Calendar; every 6 h it cleans up. Heartbeat in `WorkerHeartbeat` + a file
  for the container healthcheck.
- **db** — PostgreSQL via Prisma 7 (`@prisma/adapter-pg`). The reminder queue is a table
  (`Notification`), no Redis.
- **backup** — `pg_dump -Fc` once a day into `~/apps/hamrooz/backups` (host), 14 days kept.

## Data model (prisma/schema.prisma)

| Concept | Model | Notes |
|---|---|---|
| user / settings | `User`, `UserSettings` | timezone, work days/hours, sleep, min rest/fun, quiet hours, preview |
| session | `Session` | id = sha256(token); raw token only in an httpOnly cookie |
| task | `Task` | `dueDate`/`dueTime` (deadline) separate from `scheduledStart` (execution) |
| recurrence | `TaskRecurrence` | daily / weekly(days) / monthly / yearly, **calendar** (jalali/gregorian), month-end policy |
| occurrence | `TaskOccurrence` | sparse exceptions: done/skipped/edited/moved — the series is never mutated by one occurrence |
| birthday | `Birthday` | month/day **in its own calendar**, optional year, leap-day policy |
| deadline + renewal | `Deadline`, `DeadlineRenewal` | «تمدید شد» moves the due date and records history |
| reminder queue | `Notification` | `dedupeKey` unique, status, attempts, backoff, accepted count |
| push | `PushSubscription` | expired endpoints (404/410) are deleted |
| calendar | `CalendarConnection`, `CalendarSource`, `CalendarEvent`, `CalendarEventLink` | tokens AES-256-GCM encrypted; link = task↔event mapping |
| plan | `DailyPlan`, `DayEnergy`, `FixedBlock` | drafts are stored; acceptance applies start times |

### Time and calendars
- Exact instants are UTC `timestamp`s. Dates without a time are `YYYY-MM-DD` strings (the
  canonical civil-date spelling), times of day are `HH:mm` in the user's timezone.
- Which calendar a *rule* follows is stored separately (`CalendarKind`). A monthly Jalali rule
  uses Jalali month lengths, a Jalali birthday follows Nowruz drift, etc. (`src/lib/recurrence.ts`).
- Days that don't exist (31st in a 30-day month, 30 Esfand / 29 Feb in common years) follow an
  explicit, visible policy: `clamp` (last day of month, flagged as adjusted) or `skip`.
- Default timezone `Asia/Tehran`, configurable; "today" is always computed in that zone.

## Key flows

**Capture** — text or voice → draft → editable preview → explicit save.
`parseFa` (rule-based, Persian/colloquial) always runs. If `ANTHROPIC_API_KEY` is set, Claude
structured output is requested and **validated with zod**; invalid/refused output falls back to
the rules. Dates are resolved on the server (the model never decides the year). Voice audio is
held in memory only for the request and sent to OpenAI STT (`gpt-4o-transcribe`, `language=fa`)
after a one-time consent; nothing audio-related is stored.

**Reminders** — every change to a task/birthday/deadline calls `sync*Notifications`, which
computes the reminders that *should* exist (pure functions in `notifications/plan.ts`) and
reconciles the queue: unwanted pending rows are cancelled, cancelled rows that are wanted again
are reactivated, sent rows are never touched. The worker claims rows with
`UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`, applies the global switch, quiet hours
(defer to quiet end) and staleness (skip if >6 h late), then sends Web Push to every
subscription. Retries: 1, 5, 15 min, max 4 attempts. "Sent" means *accepted by the push
service*, not displayed.

**Planner** (`src/lib/planner.ts`) — deterministic and explainable. Window = wake → sleep (from
"now" for today) minus fixed items (calendar events, fixed blocks, tasks with a time). Fun time
is reserved first (evening), rest is protected via an invariant (breaks after `focusBlockMinutes`
of continuous work count towards it), then tasks are scored (overdue, due date, priority,
energy match) and placed earliest-fit in their allowed window (work tasks in work hours on work
days). Tasks without a duration are never placed; everything that doesn't fit is listed with a
reason. The plan is only a proposal until accepted; accepting sets planned start times, never
touches external calendars.

**Google Calendar** — OAuth code flow + PKCE + single-use `state`, minimal scopes:
`calendar.calendarlist.readonly`, `calendar.events.readonly`, `calendar.app.created`.
Selected calendars are cached for a 1-day-back/30-day-forward window (`singleEvents=true`, so
recurring events are expanded; all-day events keep date semantics). Writing happens only on an
explicit user action and only into the app-created «هم‌روز» calendar, with **deterministic event
ids** (hash of user+task+occurrence) so a retried insert returns 409 and becomes an update — no
duplicates. Disconnect revokes at Google and deletes tokens/cached events.

## API boundary
All routes under `/api` except `health`, `auth/login`, `auth/google`, `google/callback` require a
session. Every query is scoped by `userId`; other users' rows return 404. State-changing requests
must be same-origin (Origin header, falling back to `Sec-Fetch-Site`) — combined with
`SameSite=Lax` `__Host-` cookies this is the CSRF defence. Rate limits: login, voice, AI, push
test, calendar sync.

## PWA
Manifest (standalone, RTL), service worker served from `/sw.js` with the release id embedded so
each deploy produces an update banner. Caches only hashed static assets, icons and `/offline`;
never `/api/*`, OAuth or page HTML. Logout asks the SW to clear non-static caches and removes this
device's push subscription. Offline capture is out of scope (clearly stated in the UI).

## Decisions and trade-offs
- **Postgres queue instead of Redis/BullMQ** — one fewer service; `SKIP LOCKED` gives safe
  concurrency for this volume.
- **Sparse occurrences** — recurring tasks expand virtually; only exceptions are rows. Cheap and
  makes "complete one occurrence" trivially safe.
- **Windowed calendar sync** (not sync tokens / push channels) — simpler, robust, fine for one
  user; costs a few API calls every 15 min.
- **In-memory rate limits** — correct for a single web instance; reset on restart.
- **Rules first, AI optional** — the app is fully usable without any AI key; AI only improves
  parsing and is always reviewed by the user.

## Revisit for multi-user
- rate limiting and the worker's per-user resync loops (move to queued per-user jobs)
- calendar sync via incremental `syncToken` and/or push channels
- sign-up/invites, per-user OAuth consent screen verification by Google
- notification fan-out batching, partitioning/archiving of `Notification`
- off-server backups and a proper secrets manager
