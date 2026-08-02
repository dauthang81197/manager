#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# my-notion FR-14 restore script
#
# Restores ONE specific backup (DB dump + assets archive) produced by
# backup.sh. Never guesses "latest": the backup date must always be given
# explicitly on the command line, and the operator must retype it to
# confirm, because this OVERWRITES the live database and the live assets
# directory (spec-6-backup.md Boundaries: never restore automatically).
#
# This script is never invoked by cron. Run it by hand on the VPS -- see
# DEPLOYMENT.md -> "Backup tu dong (FR-14)".
# ---------------------------------------------------------------------------

POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-postgres_db}"
DB_USER="${DB_USER:-manager_app_1}"
DB_NAME="${DB_NAME:-manager}"
ASSET_STORAGE_DIR="${ASSET_STORAGE_DIR:-/root/manager/data/assets}"
BACKUP_DIR="${BACKUP_DIR:-/root/manager/backup/data}"
PG_ENV_FILE="${PG_ENV_FILE:-/root/manager/backup/pg_backup.env}"

log() { printf '[%s] %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*" >&2; }
die() { log "ERROR: $*"; exit 1; }

usage() {
  cat >&2 <<EOF
Usage: $(basename "$0") <backup-date>

  <backup-date>  the date suffix of the backup to restore, e.g. 2026-08-02.
                 Must match an existing pair of files in \$BACKUP_DIR:
                 manager-<backup-date>.sql.gz and assets-<backup-date>.tar.gz

There is no "latest" default on purpose -- you must name the exact backup
you want. This is DESTRUCTIVE: it overwrites the live '$DB_NAME' database
and the contents of '$ASSET_STORAGE_DIR'.
EOF
  exit 1
}

[ $# -eq 1 ] || usage
BACKUP_DATE="$1"

# Validate before it's interpolated into any path -- BACKUP_DATE must be a
# plain YYYY-MM-DD date, never containing `/` or `..`, so it can't make
# $DB_DUMP/$ASSETS_TAR resolve outside $BACKUP_DIR.
if ! [[ "$BACKUP_DATE" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
  die "Invalid backup date '$BACKUP_DATE' -- expected format YYYY-MM-DD (e.g. 2026-08-02)"
fi

DB_DUMP="$BACKUP_DIR/manager-${BACKUP_DATE}.sql.gz"
ASSETS_TAR="$BACKUP_DIR/assets-${BACKUP_DATE}.tar.gz"

[ -f "$DB_DUMP" ] || die "Not found: $DB_DUMP"
[ -f "$ASSETS_TAR" ] || die "Not found: $ASSETS_TAR"
[ -f "$PG_ENV_FILE" ] || die "Postgres env file not found: $PG_ENV_FILE (expected it to contain PGPASSWORD=...)"

echo "About to restore backup dated '$BACKUP_DATE':" >&2
echo "  DB dump:    $DB_DUMP  -> database '$DB_NAME' in container '$POSTGRES_CONTAINER'" >&2
echo "  Assets tar: $ASSETS_TAR -> $ASSET_STORAGE_DIR" >&2
echo "This OVERWRITES current data and cannot be undone by this script." >&2
echo "Type the backup date again to confirm ('$BACKUP_DATE'):" >&2
read -r CONFIRM
[ "$CONFIRM" = "$BACKUP_DATE" ] || die "Confirmation did not match '$BACKUP_DATE' -- aborted, nothing changed."

log "Restoring database from $DB_DUMP ..."
if ! gunzip -c "$DB_DUMP" | docker exec -i --env-file "$PG_ENV_FILE" "$POSTGRES_CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" "$DB_NAME"; then
  die "Restoring database from $DB_DUMP failed -- check the psql output above before retrying."
fi
log "Database restored from $DB_DUMP."

log "Restoring assets from $ASSETS_TAR into $ASSET_STORAGE_DIR ..."
mkdir -p "$ASSET_STORAGE_DIR"
# Clear whatever is already there first -- e.g. an image uploaded after this
# backup was taken -- so the restore actually reflects only what's in the
# chosen backup, matching the "OVERWRITES ... and cannot be undone" warning
# above instead of silently merging on top of stale files.
find "$ASSET_STORAGE_DIR" -mindepth 1 -delete
# --strip-components=1 drops the archive's own top-level directory name (set
# by backup.sh at backup time from ITS ASSET_STORAGE_DIR) and extracts the
# contents directly into today's configured $ASSET_STORAGE_DIR -- so restore
# always lands in the right place even if this directory is named/located
# differently than it was when the backup was taken (e.g. restoring into a
# scratch directory to test, per spec-6-backup.md Verification notes).
if ! tar xzf "$ASSETS_TAR" -C "$ASSET_STORAGE_DIR" --strip-components=1; then
  die "Extracting $ASSETS_TAR failed -- $ASSET_STORAGE_DIR may be partially overwritten, check manually before trusting it."
fi
log "Assets restored from $ASSETS_TAR."

log "Restore complete for backup dated $BACKUP_DATE."
