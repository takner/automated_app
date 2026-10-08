#!/usr/bin/env bash
# Deploy a specific commit of github.com/takner/automated_app to this server.
#   ~/apps/hamrooz/ops/deploy.sh <commit-sha>
# Steps: fetch the commit → build image hamrooz:<sha> → backup DB (if it exists) →
# run migrations → start the stack → wait for health → switch the `current` symlink.
set -euo pipefail

SHA_INPUT="${1:?usage: deploy.sh <commit-sha>}"
APP=/home/kian/apps/hamrooz
REPO=https://github.com/takner/automated_app.git
SRC="$APP/src"
umask 027

mkdir -p "$APP/releases" "$APP/backups" "$APP/shared" "$APP/ops"
[ -f "$APP/shared/app.env" ] && [ -f "$APP/shared/db.env" ] || { echo "missing $APP/shared/{app,db}.env" >&2; exit 1; }

if [ ! -d "$SRC/.git" ]; then git clone --quiet "$REPO" "$SRC"; fi
git -C "$SRC" fetch --quiet origin '+refs/heads/*:refs/remotes/origin/*'
SHA="$(git -C "$SRC" rev-parse --verify "$SHA_INPUT^{commit}")"
SHORT="${SHA:0:12}"
REL="$APP/releases/$SHORT"

echo "==> release $SHORT"
if [ ! -d "$REL" ]; then
  mkdir -p "$REL"
  git -C "$SRC" archive "$SHA" | tar -x -C "$REL"
fi

echo "==> building image hamrooz:$SHORT"
docker build --pull -t "hamrooz:$SHORT" --build-arg "APP_RELEASE=$SHORT" "$REL"

echo "HAMROOZ_RELEASE=$SHORT" > "$REL/release.env"
DC=(docker compose -p hamrooz -f "$REL/deploy/compose.yml" --env-file "$REL/release.env")

"${DC[@]}" up -d db
for i in $(seq 1 30); do
  "${DC[@]}" exec -T db pg_isready -U hamrooz -d hamrooz >/dev/null 2>&1 && break
  sleep 2
done

# backup before migrating existing data
HAS_TABLES="$("${DC[@]}" exec -T db psql -U hamrooz -d hamrooz -tAc "select count(*) from information_schema.tables where table_schema='public'" || echo 0)"
if [ "${HAS_TABLES//[[:space:]]/}" != "0" ]; then
  TS="$(date -u +%Y%m%dT%H%M%SZ)"
  echo "==> pre-migration backup"
  "${DC[@]}" exec -T db pg_dump -U hamrooz -d hamrooz -Fc --no-owner > "$APP/backups/pre-migrate-$SHORT-$TS.dump"
  chmod 600 "$APP/backups/pre-migrate-$SHORT-$TS.dump"
fi

echo "==> migrations"
"${DC[@]}" run --rm migrate

echo "==> starting services"
"${DC[@]}" up -d --remove-orphans web worker backup

echo "==> waiting for health"
for i in $(seq 1 45); do
  state="$(docker inspect -f '{{.State.Health.Status}}' hamrooz-web-1 2>/dev/null || echo starting)"
  [ "$state" = healthy ] && break
  sleep 2
done
[ "$state" = healthy ] || { echo "web did not become healthy" >&2; "${DC[@]}" logs --tail 50 web >&2; exit 1; }

PREV="$(readlink -f "$APP/current" 2>/dev/null || true)"
ln -sfn "$REL" "$APP/current"
[ -n "$PREV" ] && [ "$PREV" != "$REL" ] && echo "$(basename "$PREV")" > "$APP/ops/previous-release"
echo "$SHORT $(date -u +%FT%TZ)" >> "$APP/ops/deploy-history"
cp "$REL/deploy/"*.sh "$APP/ops/"
echo "==> deployed $SHORT"
