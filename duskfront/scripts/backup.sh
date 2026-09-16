#!/bin/sh
# نسخ احتياطي يومي لقاعدة البيانات / daily pg_dump loop (runs inside docker compose)
set -eu
KEEP="${BACKUP_KEEP_DAYS:-7}"
mkdir -p /backups
echo "[backup] daily pg_dump started, retention=${KEEP}d"
while true; do
  STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
  OUT="/backups/duskfront-${STAMP}.sql.gz"
  if pg_dump -h postgres -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" --no-owner | gzip -9 > "${OUT}.part"; then
    mv "${OUT}.part" "${OUT}"
    echo "[backup] wrote ${OUT}"
  else
    echo "[backup] FAILED at ${STAMP}" >&2
    rm -f "${OUT}.part"
  fi
  find /backups -name 'duskfront-*.sql.gz' -type f -mtime "+${KEEP}" -delete 2>/dev/null || true
  sleep 86400
done
