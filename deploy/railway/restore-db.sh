#!/usr/bin/env bash
set -euo pipefail

usage() {
	cat <<'EOF'
Usage: ./deploy/railway/restore-db.sh --backup-file <path> [options]

Options:
	--backup-file <file>  Local SQLite backup file to restore (required)
	--db-path <path>      Remote DB path override (default: env DATABASE_PATH or /app/data/calorie-tracker.db)
	--chunk-size <bytes>  Base64 chunk width for upload (default: 60000)
	--skip-redeploy       Do not run railway redeploy after restore
	-h, --help            Show this help

Notes:
- Requires Railway CLI to be logged in and linked (railway login, railway link).
- Always creates a pre-restore snapshot in ./backups/pre-restore by default.
- Set RAILWAY_SERVICE / RAILWAY_ENVIRONMENT to pin Railway target when needed.
EOF
}

require_cmd() {
	local cmd="$1"
	if ! command -v "$cmd" >/dev/null 2>&1; then
		echo "Missing required command: $cmd" >&2
		exit 1
	fi
}

BACKUP_FILE=""
REMOTE_DB_PATH=""
CHUNK_SIZE=60000
SKIP_REDEPLOY=0

while [[ $# -gt 0 ]]; do
	case "$1" in
		--backup-file)
			BACKUP_FILE="${2:-}"
			shift 2
			;;
		--db-path)
			REMOTE_DB_PATH="${2:-}"
			shift 2
			;;
		--chunk-size)
			CHUNK_SIZE="${2:-}"
			shift 2
			;;
		--skip-redeploy)
			SKIP_REDEPLOY=1
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

if [[ -z "$BACKUP_FILE" ]]; then
	echo "Missing required argument: --backup-file" >&2
	usage
	exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
	echo "Backup file not found: $BACKUP_FILE" >&2
	exit 1
fi

require_cmd railway
require_cmd base64
require_cmd sqlite3
require_cmd fold

if ! [[ "$CHUNK_SIZE" =~ ^[0-9]+$ ]] || [[ "$CHUNK_SIZE" -lt 1000 ]]; then
	echo "Invalid --chunk-size: $CHUNK_SIZE (must be an integer >= 1000)" >&2
	exit 1
fi

RAILWAY_OPTS=()
if [[ -n "${RAILWAY_SERVICE:-}" ]]; then
	RAILWAY_OPTS+=(--service "$RAILWAY_SERVICE")
fi
if [[ -n "${RAILWAY_ENVIRONMENT:-}" ]]; then
	RAILWAY_OPTS+=(--environment "$RAILWAY_ENVIRONMENT")
fi

railway_ssh() {
	railway ssh "${RAILWAY_OPTS[@]}" -- "$@"
}

INTEGRITY_RESULT="$(sqlite3 "$BACKUP_FILE" 'PRAGMA integrity_check;' | tr -d '\r' | tail -n 1)"
if [[ "$INTEGRITY_RESULT" != "ok" ]]; then
	echo "Provided backup file failed integrity check: $INTEGRITY_RESULT" >&2
	exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PRE_RESTORE_DIR="backups/pre-restore"
mkdir -p "$PRE_RESTORE_DIR"

BACKUP_ARGS=(--output-dir "$PRE_RESTORE_DIR")
if [[ -n "$REMOTE_DB_PATH" ]]; then
	BACKUP_ARGS+=(--db-path "$REMOTE_DB_PATH")
fi

"$SCRIPT_DIR/backup-db.sh" "${BACKUP_ARGS[@]}"

if [[ -z "$REMOTE_DB_PATH" ]]; then
	REMOTE_DB_PATH="$(railway_ssh 'echo "${DATABASE_PATH:-/app/data/calorie-tracker.db}"' | tr -d '\r' | tail -n 1)"
fi

if [[ -z "$REMOTE_DB_PATH" ]]; then
	echo "Unable to determine remote database path." >&2
	exit 1
fi

railway_ssh 'rm -f /tmp/restore.db.b64 /tmp/restore.db && : > /tmp/restore.db.b64'

while IFS= read -r chunk; do
	railway_ssh "printf '%s\\n' '$chunk' >> /tmp/restore.db.b64"
done < <(base64 -i "$BACKUP_FILE" | fold -w "$CHUNK_SIZE")

railway_ssh 'base64 -d /tmp/restore.db.b64 > /tmp/restore.db && test -s /tmp/restore.db'

railway_ssh "set -e; DB='$REMOTE_DB_PATH'; test -f /tmp/restore.db; cp \"\$DB\" \"\${DB}.before-restore-$(date +%F-%H%M%S)\"; mv /tmp/restore.db \"\$DB\"; ls -lh \"\$DB\""

railway_ssh 'rm -f /tmp/restore.db.b64'

if [[ "$SKIP_REDEPLOY" -eq 0 ]]; then
	railway redeploy
	echo "Restore completed and service redeployed."
else
	echo "Restore completed without redeploy. Run 'railway redeploy' when ready."
fi

echo "Restored from: $BACKUP_FILE"
echo "Remote DB path: $REMOTE_DB_PATH"
