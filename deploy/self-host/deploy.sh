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

"${compose[@]}" build --pull web
"${compose[@]}" up \
  --detach \
  --wait \
  --wait-timeout 180 \
  postgres
"${compose[@]}" run --rm --no-deps migrate
"${compose[@]}" run --rm --no-deps seed
"${compose[@]}" up \
  --detach \
  --no-deps \
  --remove-orphans \
  --wait \
  --wait-timeout 180 \
  web \
  worker \
  tunnel

release_ready=false
for attempt in $(seq 1 30); do
  if health="$(
    curl --fail --silent --show-error --max-time 10 \
      "http://127.0.0.1:${BUZZROUTER_PORT:-13100}/api/health"
  )" &&
    node -e '
      const health = JSON.parse(process.argv[1]);
      const expectedRelease = process.argv[2];
      const valid =
        health.status === "ok" &&
        health.migration === "0008_listing_curation.sql" &&
        health.release === expectedRelease;
      process.exit(valid ? 0 : 1);
    ' "${health}" "${target_revision}"; then
    release_ready=true
    break
  fi

  sleep 2
done

if [[ "${release_ready}" != true ]]; then
  echo "BuzzRouter did not become healthy at ${target_revision}." >&2
  exit 1
fi

printf '%s\n' "${target_revision}" >"${state_dir}/deployed-revision"
