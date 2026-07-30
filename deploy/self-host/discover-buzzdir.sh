#!/usr/bin/env bash
set -euo pipefail
umask 0077

source_dir="${BUZZROUTER_SOURCE_DIR:-/opt/buzzrouter/source}"
env_file="${BUZZROUTER_ENV_FILE:-/etc/buzzrouter/runtime.env}"
compose_file="${source_dir}/deploy/self-host/compose.yml"

if [[ ! -r "${env_file}" ]]; then
  echo "BuzzRouter runtime environment is not readable." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Required command is missing: docker" >&2
  exit 1
fi

docker compose \
  --env-file "${env_file}" \
  --file "${compose_file}" \
  --profile discovery \
  run \
  --rm \
  --no-deps \
  buzzdir-discovery
