#!/usr/bin/env bash
# Copia los respaldos locales a un almacenamiento externo (Cloudflare R2, S3, Backblaze…).
# Requiere rclone configurado con un remoto llamado "offsite". Programar en cron del VPS:
#   30 3 * * * /opt/rodasoft/infra/scripts/backup-offsite.sh >> /var/log/rodasoft-backup.log 2>&1
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/backups"
rclone sync "$DIR" offsite:rodasoft-backups --transfers 4 --checksum
echo "$(date -Is) respaldo sincronizado"
