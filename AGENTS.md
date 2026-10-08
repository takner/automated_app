# Notes for coding agents

- Read `docs/ARCHITECTURE.md` first. UI text is Persian (RTL); code and comments are English.
- Never reduce a Jalali rule/birthday to a Gregorian timestamp; keep `CalendarKind` + local dates.
- Every API handler goes through `route()` / `publicRoute()` in `src/lib/api.ts` and must scope
  queries by `user.id`.
- Any change to a task/birthday/deadline must call the matching `sync*Notifications`.
- Patch schemas must be built from base schemas without `.default()` (Zod 4 `.partial()` still
  applies defaults).
- Before pushing: `npm run typecheck && npm run test:unit && npm run test:db && npm run build`.
- Secrets live only in the server's `shared/app.env`; `.env*` files are git-ignored.
- Deploy: `~/apps/hamrooz/ops/deploy.sh <sha>` on the server (see `docs/OPERATIONS.md`).
