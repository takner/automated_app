#!/bin/sh
# Daily pg_dump (custom format) with retention. Runs inside the `backup` service.
set -eu
RETENTION="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL="${BACKUP_INTERVAL_SECONDS:-86400}"
umask 077

backup() {
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  tmp="/backups/.hamrooz-$ts.dump.partial"
  if pg_dump -Fc --no-owner -f "$tmp"; then
    mv "$tmp" "/backups/hamrooz-$ts.dump"
    echo "backup ok: hamrooz-$ts.dump ($(du -h "/backups/hamrooz-$ts.dump" | cut -f1))"
  else
    rm -f "$tmp"
    echo "backup FAILED at $ts" >&2
  fi
  find /backups -maxdepth 1 -name 'hamrooz-*.dump' -mtime "+$RETENTION" -print -delete
}

while true; do
  backup
  sleep "$INTERVAL"
done
