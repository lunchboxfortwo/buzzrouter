#!/usr/bin/env bash
set -euo pipefail

repo_url="${BUZZROUTER_REPO_URL:-https://github.com/lunchboxfortwo/buzzrouter.git}"
source_dir="${BUZZROUTER_SOURCE_DIR:-/opt/buzzrouter/source}"
state_dir="${BUZZROUTER_STATE_DIR:-/var/lib/buzzrouter}"
env_file="${BUZZROUTER_ENV_FILE:-/etc/buzzrouter/runtime.env}"
lock_file="${BUZZROUTER_LOCK_FILE:-/run/lock/buzzrouter-deploy.lock}"

mkdir -p "$(dirname "${source_dir}")" "${state_dir}"

exec 9>"${lock_file}"
flock -n 9 || exit 0

if [[ ! -d "${source_dir}/.git" ]]; then
  git clone --filter=blob:none "${repo_url}" "${source_dir}"
fi

git -C "${source_dir}" fetch --quiet origin main
target_revision="$(git -C "${source_dir}" rev-parse origin/main)"
deployed_revision="$(cat "${state_dir}/deployed-revision" 2>/dev/null || true)"
export BUZZROUTER_RELEASE_SHA="${target_revision}"

if [[ "${target_revision}" == "${deployed_revision}" ]] &&
  curl --fail --silent --show-error --max-time 10 \
    "http://127.0.0.1:${BUZZROUTER_PORT:-13100}/api/health" >/dev/null; then
  exit 0
fi

git -C "${source_dir}" checkout --quiet --detach "${target_revision}"

compose=(
  docker compose
  --env-file "${env_file}"
  --file "${source_dir}/deploy/self-host/compose.yml"
)

"${compose[@]}" build --pull web migrate
"${compose[@]}" up --detach --remove-orphans --wait --wait-timeout 180

health="$(
  curl --fail --silent --show-error --max-time 15 \
    "http://127.0.0.1:${BUZZROUTER_PORT:-13100}/api/health"
)"

node -e '
  const health = JSON.parse(process.argv[1]);
  if (health.status !== "ok" || health.migration !== "0004_public_directory.sql") {
    process.exit(1);
  }
' "${health}"

printf '%s\n' "${target_revision}" >"${state_dir}/deployed-revision"
