#!/usr/bin/env bash
# Daily MongoDB backup for NexGuard. Needs the MongoDB Database Tools (mongodump, mongorestore).
#
#   MONGODB_URI=... BACKUP_DIR=/var/backups/nexguard ./scripts/backup.sh
#
# Keeps KEEP_DAYS days of compressed archives (default 14). Run it from cron, for example:
#   15 2 * * *  cd /srv/nexguard/backend && MONGODB_URI=... ./scripts/backup.sh >> /var/log/nexguard-backup.log 2>&1
#
# Copy the archives somewhere else too (another server or object storage): a backup on the same disk
# as the database is lost with it. Restore (into an empty database):
#   mongorestore --uri "$MONGODB_URI" --gzip --archive=nexguard-YYYY-MM-DD-HHMM.archive.gz --drop
set -euo pipefail

: "${MONGODB_URI:?Set MONGODB_URI}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%d-%H%M)"
FILE="$BACKUP_DIR/nexguard-$STAMP.archive.gz"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

echo "$(date -u +%FT%TZ) backing up to $FILE"
# Proof photos are in the database too (uploads collection), so the archive holds personal data: keep it private.
mongodump --uri "$MONGODB_URI" --gzip --archive="$FILE"
chmod 600 "$FILE"

# Check the archive can be read before deleting older ones.
mongorestore --gzip --archive="$FILE" --dryRun --quiet

find "$BACKUP_DIR" -name 'nexguard-*.archive.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) done: $(du -h "$FILE" | cut -f1)"
