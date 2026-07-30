#!/usr/bin/env bash
set -euo pipefail
umask 077

source_dir="${BUZZROUTER_SOURCE_DIR:-/opt/buzzrouter/source}"
backup_dir="${BUZZROUTER_BACKUP_DIR:-/var/backups/buzzrouter}"
env_file="${BUZZROUTER_ENV_FILE:-/etc/buzzrouter/runtime.env}"
retention_days="${BUZZROUTER_BACKUP_RETENTION_DAYS:-14}"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
temporary="${backup_dir}/.${timestamp}.dump.tmp"
destination="${backup_dir}/${timestamp}.dump"

mkdir -p "${backup_dir}"

compose=(
  docker compose
  --env-file "${env_file}"
  --file "${source_dir}/deploy/self-host/compose.yml"
)

"${compose[@]}" exec --no-TTY postgres \
  pg_dump --username buzzrouter --dbname buzzrouter --format custom >"${temporary}"

pg_restore --list "${temporary}" >/dev/null
mv "${temporary}" "${destination}"
find "${backup_dir}" -type f -name '*.dump' -mtime "+${retention_days}" -delete
