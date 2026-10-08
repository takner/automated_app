#!/usr/bin/env bash
# Verifies the newest backup can be restored, into a throwaway PostgreSQL container that has
# no network and is removed afterwards. Production data is not touched.
#   ~/apps/hamrooz/ops/restore-test.sh [path/to/backup.dump]
set -euo pipefail
APP=/home/kian/apps/hamrooz
DUMP="${1:-$(ls -1t "$APP"/backups/hamrooz-*.dump | head -1)}"
NAME="hamrooz-restore-test-$$"
echo "restoring $(basename "$DUMP") into $NAME"
docker run -d --rm --name "$NAME" --network none -e POSTGRES_PASSWORD=restore-test -e POSTGRES_DB=restore postgres:16-alpine >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT
for i in $(seq 1 30); do docker exec "$NAME" pg_isready -U postgres -d restore >/dev/null 2>&1 && break; sleep 1; done
sleep 2
docker exec -i "$NAME" pg_restore -U postgres -d restore --no-owner --exit-on-error < "$DUMP"
docker exec "$NAME" psql -U postgres -d restore -tAc \
  "select 'users='||(select count(*) from \"User\")||' tasks='||(select count(*) from \"Task\")||' birthdays='||(select count(*) from \"Birthday\")||' deadlines='||(select count(*) from \"Deadline\")||' migrations='||(select count(*) from _prisma_migrations)"
echo "restore test OK"
