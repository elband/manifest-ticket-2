#!/usr/bin/env bash
# AFVS — Backup DB MySQL + folder uploads (foto wajah). Linux/on-prem.
# Pemakaian: ./backup-db.sh   (baca kredensial dari backend/.env)
# Jadwalkan via cron, mis. tiap hari 02:00:
#   0 2 * * * /path/ke/backend/scripts/backup-db.sh >> /var/log/afvs-backup.log 2>&1
set -euo pipefail

# --- Lokasi ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_ROOT="${AFVS_BACKUP_DIR:-/var/backups/afvs}"   # override via env bila perlu
KEEP_DAYS="${AFVS_BACKUP_KEEP_DAYS:-14}"              # rotasi: hapus lebih tua dari N hari

# --- Baca DATABASE_URL dari backend/.env ---
if [[ ! -f "$BACKEND_DIR/.env" ]]; then
  echo "ERROR: $BACKEND_DIR/.env tidak ada" >&2; exit 1
fi
DB_URL="$(grep -E '^DATABASE_URL=' "$BACKEND_DIR/.env" | head -n1 | sed -E 's/^DATABASE_URL=//; s/^"//; s/"$//')"
# Parse mysql://user:pass@host:port/dbname
proto_removed="${DB_URL#mysql://}"
creds="${proto_removed%@*}"; hostpart="${proto_removed#*@}"
DB_USER="${creds%%:*}"; DB_PASS="${creds#*:}"
hostport="${hostpart%%/*}"; DB_NAME="${hostpart#*/}"; DB_NAME="${DB_NAME%%\?*}"
DB_HOST="${hostport%%:*}"; DB_PORT="${hostport#*:}"; [[ "$DB_PORT" == "$DB_HOST" ]] && DB_PORT=3306

STAMP="$(date +%Y%m%d_%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

echo "[$(date)] Backup DB '$DB_NAME' @ $DB_HOST:$DB_PORT → $DEST"

# --- Dump DB (single-transaction: konsisten tanpa lock lama untuk InnoDB) ---
mysqldump --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" --password="$DB_PASS" \
  --single-transaction --quick --routines --triggers --no-tablespaces "$DB_NAME" \
  | gzip > "$DEST/afvs-db.sql.gz"

# --- Backup folder uploads (foto wajah = data biometrik, WAJIB ikut) ---
UPLOAD_DIR="$(grep -E '^UPLOAD_DIR=' "$BACKEND_DIR/.env" | head -n1 | sed -E 's/^UPLOAD_DIR=//; s/^"//; s/"$//')"
UPLOAD_DIR="${UPLOAD_DIR:-./uploads}"
[[ "$UPLOAD_DIR" != /* ]] && UPLOAD_DIR="$BACKEND_DIR/$UPLOAD_DIR"
if [[ -d "$UPLOAD_DIR" ]]; then
  tar -czf "$DEST/uploads.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"
  echo "  uploads → uploads.tar.gz"
else
  echo "  (UPLOAD_DIR $UPLOAD_DIR tidak ada — dilewati)"
fi

# --- Rotasi: hapus backup lebih tua dari KEEP_DAYS ---
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '20*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true

echo "[$(date)] Backup selesai: $DEST ($(du -sh "$DEST" | cut -f1))"
