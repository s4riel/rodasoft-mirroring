#!/usr/bin/env bash
# Restaura un respaldo en una base NUEVA para probarlo (prueba de restauración mensual).
#   infra/scripts/restore.sh infra/backups/daily/rodasoft-20261019.sql.gz rodasoft_restore
set -euo pipefail
FILE="$1"; TARGET="${2:-rodasoft_restore}"
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T postgres \
  sh -c "dropdb --if-exists -U \$POSTGRES_USER $TARGET && createdb -U \$POSTGRES_USER $TARGET"
gunzip -c "$FILE" | docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T postgres \
  sh -c "psql -U \$POSTGRES_USER -d $TARGET -v ON_ERROR_STOP=1"
echo "Restaurado en $TARGET"
