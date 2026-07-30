#!/usr/bin/env bash
set -euo pipefail
umask 0077

source_dir="${BUZZROUTER_SOURCE_DIR:-/opt/buzzrouter/source}"
env_file="${BUZZROUTER_ENV_FILE:-/etc/buzzrouter/runtime.env}"
compose_file="${source_dir}/deploy/self-host/compose.yml"

for command in docker gh; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is missing: ${command}" >&2
    exit 1
  fi
done

if [[ ! -r "${env_file}" ]]; then
  echo "BuzzRouter runtime environment is not readable." >&2
  exit 1
fi

github_token="$(gh auth token)"
if [[ -z "${github_token}" ]]; then
  echo "GitHub authentication is unavailable." >&2
  exit 1
fi

export GITHUB_TOKEN="${github_token}"
unset github_token

docker compose \
  --env-file "${env_file}" \
  --file "${compose_file}" \
  run \
  --rm \
  --no-deps \
  --env GITHUB_TOKEN \
  worker \
  npm run discovery:github

unset GITHUB_TOKEN
