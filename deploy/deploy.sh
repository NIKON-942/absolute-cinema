#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Run from an immutable release folder. A third argument enables CI's temporary
# GHCR login; its token is read from stdin, never passed on the command line.
export IMAGE_PREFIX="${1:?Usage: deploy.sh ghcr.io/owner/repo COMMIT_SHA [registry-user]}"
export IMAGE_TAG="${2:?Missing full commit SHA}"
export DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/absolute-cinema}"
[[ "$IMAGE_PREFIX" =~ ^ghcr\.io/[a-z0-9._/-]+$ ]] || { echo 'Invalid image prefix' >&2; exit 1; }
[[ "$IMAGE_TAG" =~ ^[a-f0-9]{40}$ ]] || { echo 'Expected a full commit SHA' >&2; exit 1; }
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ -s "$DEPLOY_ROOT/.env" ]] || { echo 'Create the server .env first' >&2; exit 1; }
exec 9>"$DEPLOY_ROOT/.deploy.lock"
flock -w 600 9

temporary_docker_config=''
cleanup() {
  if [[ -n "$temporary_docker_config" ]]; then
    rm -f -- "$temporary_docker_config/config.json"
    rmdir -- "$temporary_docker_config" || true
  fi
}
trap cleanup EXIT
if [[ -n "${3:-}" ]]; then
  temporary_docker_config="$(mktemp -d)"
  export DOCKER_CONFIG="$temporary_docker_config"
  IFS= read -r registry_token
  printf '%s' "$registry_token" | docker login ghcr.io -u "$3" --password-stdin
  unset registry_token
fi

compose() {
  docker compose --env-file "$DEPLOY_ROOT/.env" -f "$release_dir/compose.yml" "$@"
}
compose config --quiet
# Complete downloads before changing any running application containers.
compose pull
compose up -d --wait --wait-timeout 120 postgres

# Each subsequent deployment saves the database before running migrations.
# On failure, leave the current marker unchanged; do not reverse migrations.
if [[ -L "$DEPLOY_ROOT/current" ]]; then
  bash "$release_dir/backup.sh"
fi
compose run --rm --no-deps backend node dist/database/run-migrations.js
compose run --rm --no-deps backend node dist/database/bootstrap.js
if ! compose up -d --wait --wait-timeout 240; then
  compose ps >&2
  echo 'Deployment failed. Inspect container logs; current release marker was not advanced.' >&2
  echo 'Migrations may already be applied; review schema compatibility before rolling back.' >&2
  exit 1
fi

# Check both the SPA fallback and DB readiness through Caddy. --resolve keeps
# this local while still testing the configured Host/SNI and TLS certificate.
site_address="$(compose exec -T web printenv SITE_ADDRESS)"
if [[ "$site_address" == http://* ]]; then
  host="${site_address#http://}"
  host="${host%%/*}"
  host="${host%%:*}"
  for path in /login /api/health/ready; do
    curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 \
      --max-time 10 --resolve "$host:80:127.0.0.1" "http://$host$path" > /dev/null
  done
else
  host="${site_address#https://}"
  host="${host%%/*}"
  for path in /login /api/health/ready; do
    curl --fail --silent --show-error --retry 12 --retry-all-errors --retry-delay 5 \
      --max-time 10 --resolve "$host:443:127.0.0.1" "https://$host$path" > /dev/null
  done
fi

if [[ -L "$DEPLOY_ROOT/current" && "$(readlink "$DEPLOY_ROOT/current")" != "$release_dir" ]]; then
  ln -sfn "$(readlink "$DEPLOY_ROOT/current")" "$DEPLOY_ROOT/previous"
fi
printf 'IMAGE_PREFIX=%s\nIMAGE_TAG=%s\n' "$IMAGE_PREFIX" "$IMAGE_TAG" > "$release_dir/images.env"
ln -sfn "$release_dir" "$DEPLOY_ROOT/current"
echo "Deployment healthy: $IMAGE_TAG"
