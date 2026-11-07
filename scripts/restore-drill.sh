#!/bin/sh
set -eu
# 只在 backup 服务内执行，临时库和目录由本脚本创建并清理。
if [ "${1:-}" != --inside ]; then
  exec docker compose run --rm --no-deps --entrypoint /bin/sh backup /scripts/restore-drill.sh --inside
fi
latest=$(find /backups -mindepth 1 -maxdepth 1 -type d ! -name '.pending-*' | sort | tail -n 1)
test -n "$latest" || { echo 'No completed backup found' >&2; exit 1; }
drill_db="waypoint_drill_$(date +%s)_$$"
drill_dir=$(mktemp -d /tmp/waypoint-drill-XXXXXX)
created=0
cleanup() {
  if [ "$created" -eq 1 ]; then
    dropdb --if-exists "$drill_db"
  fi
  rm -rf "$drill_dir"
}
trap cleanup EXIT HUP INT TERM
createdb "$drill_db"
created=1
pg_restore --exit-on-error --no-owner --dbname="$drill_db" "$latest/database.dump"
tar -xzf "$latest/uploads.tar.gz" -C "$drill_dir"
PGDATABASE="$drill_db" psql -XAt -v ON_ERROR_STOP=1 -f /backup/counts.sql > "$drill_dir/rows.actual"
cmp "$latest/rows.txt" "$drill_dir/rows.actual"
expected=$(cat "$latest/files.txt")
actual=$(find "$drill_dir" -type f ! -name rows.actual | wc -l | tr -d ' ')
test "$expected" = "$actual"
echo "Restore drill passed: table counts match; $actual upload files restored"
