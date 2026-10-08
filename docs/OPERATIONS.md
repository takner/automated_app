# Operations runbook

Server: `kian@185.211.5.240` · URL: https://auto.levian.tech · Compose project: `hamrooz`

## Layout on the server

```
/home/kian/apps/hamrooz/
  src/                 git clone of github.com/takner/automated_app (source for releases)
  releases/<sha12>/    extracted source of each deployed commit (+ release.env)
  current -> releases/<sha12>
  shared/app.env       app secrets (mode 600)    shared/db.env  database password (mode 600)
  backups/             daily pg_dump files + pre-migration dumps (mode 600)
  ops/                 deploy.sh, rollback.sh, restore-test.sh, restore.sh, deploy-history
  private/             one-off files such as the initial owner password (mode 700/600)
```

Containers: `hamrooz-db-1`, `hamrooz-web-1`, `hamrooz-worker-1`, `hamrooz-backup-1`.
Traefik (shared, already on the server) routes `auto.levian.tech` → `web:3000` and issues the
Let's Encrypt certificate (resolver `letsencrypt`, auto-renewing). The database has no published
port and lives on an internal-only Docker network.

Shorthand used below:

```bash
cd ~/apps/hamrooz/current && DC="docker compose -p hamrooz -f deploy/compose.yml --env-file release.env"
```

## Everyday commands

| Task | Command |
|---|---|
| status | `$DC ps` |
| logs | `$DC logs -f --tail 100 web` (or `worker`, `backup`, `db`) |
| restart | `$DC restart web worker` |
| health | `curl -s https://auto.levian.tech/api/health` |
| deploy a commit | `~/apps/hamrooz/ops/deploy.sh <sha>` |
| roll back app | `~/apps/hamrooz/ops/rollback.sh [release]` (default: previous) |
| backup now | `$DC exec -T db pg_dump -U hamrooz -d hamrooz -Fc --no-owner > ~/apps/hamrooz/backups/manual-$(date -u +%Y%m%dT%H%M%SZ).dump` |
| test a restore | `~/apps/hamrooz/ops/restore-test.sh` (throwaway container, no network) |
| restore (destructive) | `~/apps/hamrooz/ops/restore.sh <dump>` |
| export owner data | `$DC run --rm cli export --email <owner> > export.json` |
| set owner password | `$DC run --rm -T cli set-password --email <owner>` then type the password and press Ctrl-D |

## Deploy
`deploy.sh <sha>` fetches the commit, builds `hamrooz:<sha12>`, takes a pre-migration dump when
the database already has tables, runs `prisma migrate deploy`, starts the services, waits for the
web healthcheck and only then switches `current`. Releases and images are kept for rollback.

## Rollback
`rollback.sh` switches web/worker to an older image. **Migrations are not reverted.** It is safe
only when the older code works with the newer schema (additive migrations). Otherwise restore the
`pre-migrate-<sha>-*.dump` taken before that deploy — data written after it is lost.

## Backups
Daily, 14-day retention, on the same server only. **There is no off-server copy yet** — copy
`~/apps/hamrooz/backups` elsewhere (e.g. `rsync`/`rclone` to another host) for real disaster
recovery.

## Monitoring
`/api/health` reports DB status, worker heartbeat age and the number of reminders more than
5 minutes overdue (`laggingReminders`). The worker container is marked unhealthy if its heartbeat
file is older than 2 minutes. Settings → اعلان‌ها shows the same data to the owner.

## Configuration still owned by the operator
See `.env.example` for every variable. Integrations stay disabled (and say so in the UI) until
their variables are present in `shared/app.env`; after editing run `$DC up -d web worker`.

### Google OAuth (Calendar + Google sign-in)
1. Google Cloud console → create a project → enable **Google Calendar API**.
2. OAuth consent screen: External, add the owner as a test user (or publish). Scopes:
   `openid`, `email`, `…/auth/calendar.calendarlist.readonly`, `…/auth/calendar.events.readonly`,
   `…/auth/calendar.app.created`.
3. Credentials → OAuth client ID → Web application. Authorized redirect URI:
   `https://auto.levian.tech/api/google/callback`.
4. Put `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `shared/app.env`, restart web+worker.
5. In the app: Settings → Google Calendar → اتصال. Choose which calendars block time.

### Voice (Persian speech-to-text)
Set `OPENAI_API_KEY` (and optionally `STT_MODEL`, default `gpt-4o-transcribe`). Optional smarter
parsing: `ANTHROPIC_API_KEY` (`EXTRACT_MODEL`, default `claude-opus-5-5`).
