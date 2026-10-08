#!/usr/bin/env bash
# Roll the application back to an earlier release that is still on disk:
#   ~/apps/hamrooz/ops/rollback.sh [release-short-sha]   (default: ops/previous-release)
# This switches the web/worker image only. Database migrations are NOT reverted; a rollback
# is only safe when the older code is compatible with the current schema. If not, restore the
# pre-migration backup (see restore.sh) — that loses data written after the backup.
set -euo pipefail
APP=/home/kian/apps/hamrooz
TARGET="${1:-$(cat "$APP/ops/previous-release")}"
REL="$APP/releases/$TARGET"
[ -d "$REL" ] || { echo "no release $TARGET on disk" >&2; exit 1; }
docker image inspect "hamrooz:$TARGET" >/dev/null || docker build -t "hamrooz:$TARGET" --build-arg "APP_RELEASE=$TARGET" "$REL"
echo "HAMROOZ_RELEASE=$TARGET" > "$REL/release.env"
docker compose -p hamrooz -f "$REL/deploy/compose.yml" --env-file "$REL/release.env" up -d --remove-orphans web worker backup
ln -sfn "$REL" "$APP/current"
echo "$TARGET $(date -u +%FT%TZ) rollback" >> "$APP/ops/deploy-history"
echo "rolled back to $TARGET"
