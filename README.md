# هم‌روز (Hamrooz)

PWA فارسی و تک‌کاربره برای مدیریت کارهای شخصی و کاری، یادآوری تولدها و سررسیدها (مثل بیمهٔ
ماشین)، برنامهٔ روزانهٔ واقع‌بینانه با سهم مشخص استراحت و تفریح، اتصال به Google Calendar،
ثبت صوتی و اعلان Web Push.

- محصول: https://auto.levian.tech
- معماری: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- نگهداری و دیپلوی: [docs/OPERATIONS.md](docs/OPERATIONS.md)

## Stack
Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · PostgreSQL 16 · Prisma 7 · zod ·
web-push · Luxon + jalaali-js · Vitest · Playwright · Docker Compose behind Traefik.

## Local development

```bash
cp .env.example .env          # fill DATABASE_URL, TEST_DATABASE_URL, DEV_OWNER_* …
npm ci
npx prisma migrate deploy
npm run seed:dev              # development-only sample data + dev owner
npm run dev                   # http://localhost:3000
```

Worker (reminders, calendar sync): `npm run worker`.

## Tests

```bash
npm run typecheck
npm run test:unit             # dates, recurrence, planner, Persian parser
npm run test:db               # needs TEST_DATABASE_URL (real PostgreSQL)
npm run build && npm run test:e2e   # Playwright, mobile + desktop
```

## Layout

```
prisma/              schema + migrations
src/app/             pages (App Router) and /api route handlers
src/components/      client UI
src/lib/             dates, recurrence, planner, capture (parser/AI), notifications, google, services
src/worker/          background worker      src/cli/  operator CLI
deploy/              compose.yml, deploy/rollback/backup/restore scripts
tests/               unit, db (integration), e2e
```
