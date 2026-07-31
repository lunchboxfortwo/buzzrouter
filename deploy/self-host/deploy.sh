#!/usr/bin/env bash
set -euo pipefail

repo_url="${BUZZROUTER_REPO_URL:-https://github.com/lunchboxfortwo/buzzrouter.git}"
source_dir="${BUZZROUTER_SOURCE_DIR:-/opt/buzzrouter/source}"
state_dir="${BUZZROUTER_STATE_DIR:-/var/lib/buzzrouter}"
env_file="${BUZZROUTER_ENV_FILE:-/etc/buzzrouter/runtime.env}"
lock_file="${BUZZROUTER_LOCK_FILE:-/run/lock/buzzrouter-deploy.lock}"

mkdir -p "$(dirname "${source_dir}")" "${state_dir}"

deploy_log="${state_dir}/last-deploy.log"
exec > >(tee "${deploy_log}") 2>&1
trap 'chmod 0644 "${deploy_log}" 2>/dev/null || true' EXIT
set -x

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

# Assert every migration file in the deploying revision has been applied, not
# just the single newest name: under concurrency production's newest applied
# migration can legitimately run ahead of this revision's newest file, which a
# newest-to-newest comparison would misreport as a failure. A subset check
# tolerates production being ahead while still failing on a genuinely missing one.
release_ready=false
for attempt in $(seq 1 30); do
  if health="$(
    curl --fail --silent --show-error --max-time 10 \
      "http://127.0.0.1:${BUZZROUTER_PORT:-13100}/api/health"
  )" &&
    node -e '
      const fs = require("node:fs");
      const health = JSON.parse(process.argv[1]);
      const expectedRelease = process.argv[2];
      const migrationsDir = process.argv[3];
      const expected = fs
        .readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql"))
        .sort();
      const applied = new Set(
        Array.isArray(health.migrations) ? health.migrations : [],
      );
      const missing = expected.filter((name) => !applied.has(name));
      if (missing.length > 0) {
        console.error(`migrations not yet applied: ${missing.join(", ")}`);
      }
      const valid =
        health.status === "ok" &&
        health.release === expectedRelease &&
        missing.length === 0;
      process.exit(valid ? 0 : 1);
    ' "${health}" "${target_revision}" "${source_dir}/migrations"; then
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
