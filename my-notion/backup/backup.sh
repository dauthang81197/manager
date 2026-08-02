#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# my-notion FR-14 backup script
#
# Dumps the `postgres_db` container's `manager` database and archives the
# ASSET_STORAGE_DIR image bind-mount TOGETHER, in one invocation, and keeps
# the 7 most recent daily backups. Old backups are deleted only after BOTH
# new files (DB dump + assets tar) have been written successfully -- a
# failed run never touches existing backups (spec-6-backup.md Boundaries).
#
# Runs on the VPS HOST via cron, not inside a container: Postgres lives in
# `postgres_db`, a container shared with other projects on the host and
# outside this project's docker-compose, so this script shells out to it via
# `docker exec` instead of requiring its own `pg_dump` install (see Design
# Notes in spec-6-backup.md).
#
# See DEPLOYMENT.md -> "Backup tu dong (FR-14)" for the crontab line and the
# Postgres password env file this script expects.
# ---------------------------------------------------------------------------

# --- Configuration (override via environment, e.g. from crontab) -----------

# Name of the running Postgres container (docker exec target).
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres_db}"
# DB role used for pg_dump. NOT the superuser: pg_hba.conf on this host
# blocks `postgres` from network/TCP login; `manager_app_1` is the app's own
# role and is what's actually reachable.
DB_USER="${DB_USER:-manager_app_1}"
DB_NAME="${DB_NAME:-manager}"

# HOST path of the images bind-mount (container side is /app/var/assets --
# see DEPLOYMENT.md). Must be the host path: tar runs on the host, not
# inside the postgres_db container.
ASSET_STORAGE_DIR="${ASSET_STORAGE_DIR:-/root/manager/data/assets}"

# Where backups are written. MUST be a different directory than both the
# Postgres data directory and ASSET_STORAGE_DIR (Boundaries: never overwrite
# the live data itself).
BACKUP_DIR="${BACKUP_DIR:-/root/manager/backup/data}"

# File containing `PGPASSWORD=...` for the docker-exec'd pg_dump. Read via
# `docker exec --env-file`, never via -e/CLI arg (would leak the password
# into `ps`/shell history) and never hardcoded in this script.
PG_ENV_FILE="${PG_ENV_FILE:-/root/manager/backup/pg_backup.env}"

# How many daily backups to retain.
RETENTION_COUNT="${RETENTION_COUNT:-7}"

# ---------------------------------------------------------------------------

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

if ! [[ "$RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]]; then
  die "RETENTION_COUNT must be a positive integer, got: '$RETENTION_COUNT'"
fi

[ -f "$PG_ENV_FILE" ] || die "Postgres env file not found: $PG_ENV_FILE (expected it to contain PGPASSWORD=...)"
[ -d "$ASSET_STORAGE_DIR" ] || die "ASSET_STORAGE_DIR not found: $ASSET_STORAGE_DIR"

# Guard rail for the "never overwrite live data" boundary: refuse to run if
# the backup dir and the live assets dir nest inside one another.
case "$BACKUP_DIR" in
  "$ASSET_STORAGE_DIR"|"$ASSET_STORAGE_DIR"/*)
    die "BACKUP_DIR ($BACKUP_DIR) is inside ASSET_STORAGE_DIR ($ASSET_STORAGE_DIR) -- refusing to run" ;;
esac
case "$ASSET_STORAGE_DIR" in
  "$BACKUP_DIR"|"$BACKUP_DIR"/*)
    die "ASSET_STORAGE_DIR ($ASSET_STORAGE_DIR) is inside BACKUP_DIR ($BACKUP_DIR) -- refusing to run" ;;
esac

mkdir -p "$BACKUP_DIR"

# A prior run that was SIGKILL'd (VPS OOM-kill, hard reboot mid-run) never
# gets to fire the EXIT trap below, so its `.tmp.*` file(s) can be left
# behind indefinitely -- uncounted by rotation and never cleaned up on
# their own. Sweep those up before this run creates its own.
find "$BACKUP_DIR" -maxdepth 1 -name '*.tmp.*' -delete

TIMESTAMP="$(date -u +'%Y-%m-%d')"
DB_DUMP_FINAL="$BACKUP_DIR/manager-${TIMESTAMP}.sql.gz"
ASSETS_TAR_FINAL="$BACKUP_DIR/assets-${TIMESTAMP}.tar.gz"
DB_DUMP_TMP="${DB_DUMP_FINAL}.tmp.$$"
ASSETS_TAR_TMP="${ASSETS_TAR_FINAL}.tmp.$$"

# Edge case: disk fills up mid-write (or any other unexpected exit) -- never
# leave a half-written temp file behind next to the real backups. (Does not
# cover SIGKILL, which skips traps entirely -- that's what the sweep above
# is for.)
cleanup_tmp() { rm -f "$DB_DUMP_TMP" "$ASSETS_TAR_TMP"; }
trap cleanup_tmp EXIT

log "Starting backup: db=$DB_NAME container=$POSTGRES_CONTAINER assets=$ASSET_STORAGE_DIR -> $BACKUP_DIR"

# --- 1. Dump the database ---------------------------------------------------
# --clean --if-exists: emit DROP ... IF EXISTS before each CREATE, so restore
# works against a target schema that isn't empty -- notably the real
# disaster-recovery case, where the backend container's own `prisma migrate
# deploy` (its Dockerfile CMD) has already recreated the full schema before
# anyone runs restore.sh. Without this, replaying the dump would hit
# "relation already exists" on the first CREATE TABLE and abort immediately.
if ! docker exec --env-file "$PG_ENV_FILE" "$POSTGRES_CONTAINER" \
    pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" | gzip > "$DB_DUMP_TMP"; then
  die "pg_dump failed (container=$POSTGRES_CONTAINER user=$DB_USER db=$DB_NAME) -- no existing backups were touched"
fi
[ -s "$DB_DUMP_TMP" ] || die "pg_dump produced an empty dump -- no existing backups were touched"

# --- 2. Archive the images directory ----------------------------------------
if ! tar czf "$ASSETS_TAR_TMP" -C "$(dirname "$ASSET_STORAGE_DIR")" "$(basename "$ASSET_STORAGE_DIR")"; then
  die "tar of $ASSET_STORAGE_DIR failed -- no existing backups were touched"
fi

# --- 3. Both succeeded: publish atomically, then rotate ---------------------
mv "$DB_DUMP_TMP" "$DB_DUMP_FINAL"
mv "$ASSETS_TAR_TMP" "$ASSETS_TAR_FINAL"
log "Wrote $DB_DUMP_FINAL and $ASSETS_TAR_FINAL"

# Rotation: keep the RETENTION_COUNT most recent files per kind, oldest
# first. Only reached once both new files above exist on disk -- any
# failure above `die`s (and exits via the trap) before this point, so a
# failed run never deletes anything (Boundaries).
rotate() {
  local pattern="$1"
  local files count
  files=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name "$pattern" | sort)
  count=$(printf '%s\n' "$files" | grep -c . || true)
  if [ "$count" -gt "$RETENTION_COUNT" ]; then
    printf '%s\n' "$files" | head -n "$((count - RETENTION_COUNT))" | while IFS= read -r f; do
      log "Rotating out old backup: $f"
      rm -f "$f"
    done
  fi
}

rotate 'manager-*.sql.gz'
rotate 'assets-*.tar.gz'

log "Backup complete."
