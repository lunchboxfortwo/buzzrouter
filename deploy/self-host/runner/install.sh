#!/usr/bin/env bash
set -euo pipefail
umask 0077

runner_version="2.336.0"
runner_sha256="04cf0be1aff4c3ec3554466c39124ca250e3effd8873bb7e8d68535aa9505d5d"
runner_url="https://github.com/actions/runner/releases/download/v${runner_version}/actions-runner-linux-x64-${runner_version}.tar.gz"
repository_url="https://github.com/lunchboxfortwo/buzzrouter"
runner_user="buzzrouter-runner"
runner_group="buzzrouter-runner"
runner_dir="/opt/buzzrouter-actions-runner"
runner_home="/var/lib/buzzrouter-actions-runner"
runner_name="buzzrouter-production-$(hostname --short)"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this installer as root." >&2
  exit 1
fi

for command in curl python3 runuser sha256sum tar systemctl useradd visudo; do
  if ! command -v "${command}" >/dev/null 2>&1; then
    echo "Required command is missing: ${command}" >&2
    exit 1
  fi
done

if ! id "${runner_user}" >/dev/null 2>&1; then
  useradd \
    --system \
    --user-group \
    --home-dir "${runner_home}" \
    --create-home \
    --shell /usr/sbin/nologin \
    "${runner_user}"
fi

runner_groups="$(id --name --groups "${runner_user}")"
if [[ "$(id --name --group "${runner_user}")" != "${runner_group}" ]]; then
  echo "${runner_user} must use ${runner_group} as its primary group." >&2
  exit 1
fi

if grep -Eq '(^| )(docker|sudo|root)( |$)' <<<"${runner_groups}"; then
  echo "${runner_user} must not belong to docker, sudo, or root groups." >&2
  exit 1
fi

install -d \
  --owner="${runner_user}" \
  --group="${runner_group}" \
  --mode=0700 \
  "${runner_dir}" \
  "${runner_home}" \
  "${runner_home}/_work"

if [[ ! -x "${runner_dir}/run.sh" ]]; then
  archive="$(mktemp)"
  trap 'rm -f "${archive}"' EXIT

  curl \
    --fail \
    --location \
    --proto '=https' \
    --tlsv1.2 \
    --output "${archive}" \
    "${runner_url}"

  printf '%s  %s\n' "${runner_sha256}" "${archive}" | sha256sum --check
  tar --extract --gzip --file="${archive}" --directory="${runner_dir}"
  chown -R "${runner_user}:${runner_group}" "${runner_dir}"
  "${runner_dir}/bin/installdependencies.sh"
fi

if [[ ! -f "${runner_dir}/.runner" ]]; then
  if [[ -t 0 ]]; then
    echo "Pipe a repository runner registration token to this installer." >&2
    exit 1
  fi

  IFS= read -r registration_token
  if [[ -z "${registration_token}" ]]; then
    echo "The runner registration token was empty." >&2
    exit 1
  fi

  runuser --user="${runner_user}" -- \
    "${runner_dir}/config.sh" \
    --unattended \
    --url "${repository_url}" \
    --token "${registration_token}" \
    --name "${runner_name}" \
    --labels buzzrouter-production \
    --no-default-labels \
    --work "${runner_home}/_work" \
    --replace

  unset registration_token
fi

visudo --check --file="${script_dir}/buzzrouter-actions-runner.sudoers"
install \
  --owner=root \
  --group=root \
  --mode=0440 \
  "${script_dir}/buzzrouter-actions-runner.sudoers" \
  /etc/sudoers.d/buzzrouter-actions-runner

install \
  --owner=root \
  --group=root \
  --mode=0644 \
  "${script_dir}/buzzrouter-actions-runner.service" \
  /etc/systemd/system/buzzrouter-actions-runner.service

systemctl daemon-reload
systemctl enable --now buzzrouter-actions-runner.service

if systemctl cat buzzrouter-deploy.timer >/dev/null 2>&1; then
  systemctl disable --now buzzrouter-deploy.timer
fi

systemctl --no-pager --full status buzzrouter-actions-runner.service
