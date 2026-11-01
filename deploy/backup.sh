#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
export DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/absolute-cinema}"
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# Standalone backup commands use the last successful image selection.
if [[ -z "${IMAGE_TAG:-}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$release_dir/images.env"
  set +a
fi
mkdir -p "$DEPLOY_ROOT/backups"
backup="$DEPLOY_ROOT/backups/database-$(date -u +%Y%m%dT%H%M%S)-$$.dump"
trap 'rm -f -- "$backup.partial"' EXIT
docker compose --env-file "$DEPLOY_ROOT/.env" -f "$release_dir/compose.yml" \
  exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup.partial"
[[ -s "$backup.partial" ]]
mv -- "$backup.partial" "$backup"
echo "Database backup: $backup"
# Retention and copies outside this VM are explicit operator choices.
