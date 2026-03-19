#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./deploy/railway/backup-db.sh [options]

Options:
  --output-dir <dir>   Local directory for backups (default: ./backups)
  --db-path <path>     Remote DB path override (default: env DATABASE_PATH or /app/data/calorie-tracker.db)
  --keep-intermediate  Keep intermediate raw/base64 files
  -h, --help           Show this help

Notes:
- Requires Railway CLI to be logged in and linked (railway login, railway link).
- Uses base64 transfer to avoid binary corruption over ssh output.
EOF
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

OUTPUT_DIR="backups"
REMOTE_DB_PATH=""
KEEP_INTERMEDIATE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      OUTPUT_DIR="${2:-}"
      shift 2
      ;;
    --db-path)
      REMOTE_DB_PATH="${2:-}"
      shift 2
      ;;
    --keep-intermediate)
      KEEP_INTERMEDIATE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

require_cmd railway
require_cmd awk
require_cmd base64
require_cmd sqlite3

mkdir -p "$OUTPUT_DIR"

if [[ -z "$REMOTE_DB_PATH" ]]; then
  REMOTE_DB_PATH="$(railway ssh -- 'echo "${DATABASE_PATH:-/app/data/calorie-tracker.db}"' | tr -d '\r' | tail -n 1)"
fi

if [[ -z "$REMOTE_DB_PATH" ]]; then
  echo "Unable to determine remote database path." >&2
  exit 1
fi

TIMESTAMP="$(date +%F-%H%M%S)"
RAW_FILE="$OUTPUT_DIR/railway-db-$TIMESTAMP.raw.txt"
B64_FILE="$OUTPUT_DIR/railway-db-$TIMESTAMP.b64"
BACKUP_FILE="$OUTPUT_DIR/calorie-tracker-$TIMESTAMP.db"

railway ssh -- "DB='$REMOTE_DB_PATH'; test -f \"\$DB\"; echo __DB_B64_BEGIN__; base64 \"\$DB\"; echo __DB_B64_END__" > "$RAW_FILE"

awk '/__DB_B64_BEGIN__/{flag=1;next}/__DB_B64_END__/{flag=0}flag' "$RAW_FILE" > "$B64_FILE"

if [[ ! -s "$B64_FILE" ]]; then
  echo "Failed to capture base64 payload from Railway output." >&2
  exit 1
fi

base64 -D -i "$B64_FILE" -o "$BACKUP_FILE"

INTEGRITY_RESULT="$(sqlite3 "$BACKUP_FILE" 'PRAGMA integrity_check;' | tr -d '\r' | tail -n 1)"
if [[ "$INTEGRITY_RESULT" != "ok" ]]; then
  echo "Backup integrity check failed: $INTEGRITY_RESULT" >&2
  exit 1
fi

if [[ "$KEEP_INTERMEDIATE" -eq 0 ]]; then
  rm -f "$RAW_FILE" "$B64_FILE"
fi

echo "Backup completed successfully"
echo "Remote DB path: $REMOTE_DB_PATH"
echo "Backup file: $BACKUP_FILE"
echo "Integrity: $INTEGRITY_RESULT"
