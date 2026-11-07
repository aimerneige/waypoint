#!/bin/sh
set -eu
case "${BACKUP_KEEP_DAYS:-14}" in ''|*[!0-9]*) echo 'BACKUP_KEEP_DAYS must be a positive integer' >&2; exit 1;; esac
test "${BACKUP_KEEP_DAYS:-14}" -gt 0
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dir=$(mktemp -d /backups/.pending-XXXXXX)
trap 'rm -rf "$dir"' EXIT
pg_dump -Fc -f "$dir/database.dump"
tar -czf "$dir/uploads.tar.gz" -C /uploads .
psql -XAt -v ON_ERROR_STOP=1 -f /backup/counts.sql > "$dir/rows.txt"
find /uploads -type f | wc -l | tr -d ' ' > "$dir/files.txt"
mv "$dir" "/backups/$stamp"
find /backups -mindepth 1 -maxdepth 1 -type d ! -name '.pending-*' -mtime "+${BACKUP_KEEP_DAYS:-14}" -exec rm -rf {} +
echo "Backup completed: $stamp"
