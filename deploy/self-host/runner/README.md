# Production deployment runner

This repository-level GitHub Actions runner is registered without GitHub's
default runner labels and accepts only jobs labeled `buzzrouter-production`. It
runs as the dedicated `buzzrouter-runner` account, has no Docker access, and can
elevate only this exact command:

```text
/usr/bin/systemctl start buzzrouter-deploy.service
```

The deploy job does not check out repository code. After the GitHub-hosted
`verify` job succeeds, it starts the existing deployment service and checks that
the public health endpoint reports the workflow's exact commit SHA.

## Host installation

The host must be Ubuntu amd64 with `curl`, `tar`, `sudo`, `python3`, and systemd.
The existing `buzzrouter-deploy.service` must already be installed.

From a trusted checkout of `lunchboxfortwo/buzzrouter`, create a one-hour
repository runner registration token and pipe it directly into the installer:

```bash
gh api \
  --method POST \
  repos/lunchboxfortwo/buzzrouter/actions/runners/registration-token \
  --jq .token |
  sudo deploy/self-host/runner/install.sh
```

The installer:

1. Creates the unprivileged `buzzrouter-runner` system account.
2. Downloads the pinned GitHub Actions runner and verifies its SHA-256 digest.
3. Registers a repository-level runner with the `buzzrouter-production` label.
4. Installs the hardened systemd unit and exact-command sudoers policy.
5. Starts and enables `buzzrouter-actions-runner.service`.
6. Disables `buzzrouter-deploy.timer` so unverified commits cannot bypass CI.

The registration token is required only on first installation. Re-running the
installer updates the checked-in service and sudoers configuration without
re-registering the runner:

```bash
sudo deploy/self-host/runner/install.sh </dev/null
```

## Verification

```bash
sudo systemctl status buzzrouter-actions-runner.service
sudo systemctl is-enabled buzzrouter-deploy.timer
sudo -u buzzrouter-runner sudo -n /usr/bin/systemctl start buzzrouter-deploy.service
sudo -u buzzrouter-runner sudo -n -l
```

The deploy timer check should report `disabled`.

Confirm in the repository's **Settings > Actions > Runners** page that
`buzzrouter-production-<hostname>` is idle and has the
`buzzrouter-production` label.

Because this is a public repository, keep deployment jobs push-only, do not use
this runner for pull requests, and protect `main` plus the `production`
environment. A workflow running on this runner can execute as
`buzzrouter-runner`, but the host policy prevents it from reading BuzzRouter
secrets, reaching the Docker socket, or invoking arbitrary root commands.
