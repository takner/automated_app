#!/usr/bin/env bash
# DESTRUCTIVE: replaces the production database with a backup. Stops web/worker first and
# takes a safety dump of the current state. Requires typing the release name to confirm.
#   ~/apps/hamrooz/ops/restore.sh /home/kian/apps/hamrooz/backups/<file>.dump
set -euo pipefail
APP=/home/kian/apps/hamrooz
DUMP="${1:?usage: restore.sh <backup.dump>}"
REL="$(readlink -f "$APP/current")"
DC=(docker compose -p hamrooz -f "$REL/deploy/compose.yml" --env-file "$REL/release.env")
read -r -p "This overwrites the production database with $(basename "$DUMP"). Type 'restore' to continue: " ok
[ "$ok" = restore ] || { echo aborted; exit 1; }
"${DC[@]}" stop web worker
TS="$(date -u +%Y%m%dT%H%M%SZ)"
"${DC[@]}" exec -T db pg_dump -U hamrooz -d hamrooz -Fc --no-owner > "$APP/backups/before-restore-$TS.dump"
chmod 600 "$APP/backups/before-restore-$TS.dump"
"${DC[@]}" exec -T db pg_restore -U hamrooz -d hamrooz --clean --if-exists --no-owner --exit-on-error < "$DUMP"
"${DC[@]}" up -d web worker
echo "restored $(basename "$DUMP"); previous state saved as before-restore-$TS.dump"
