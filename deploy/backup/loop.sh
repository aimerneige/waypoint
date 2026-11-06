#!/bin/sh
set -eu
if [ "${BACKUP_ON_START:-0}" = 1 ]; then sh /backup/run.sh; fi
next=$(($(date +%s) + 86400))
while :; do
  touch /tmp/backup-alive
  if [ "$(date +%s)" -ge "$next" ]; then
    sh /backup/run.sh
    next=$(($(date +%s) + 86400))
  fi
  sleep 30 &
  wait $!
done
