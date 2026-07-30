# Self-hosted production

The self-hosted stack runs PostgreSQL, the Next.js web process, migrations, the
discovery worker, and a dedicated Cloudflare Tunnel under Docker Compose.

Host paths:

- `/opt/buzzrouter/source`: clean checkout of `main`
- `/opt/buzzrouter/bin`: deployment and backup scripts
- `/etc/buzzrouter`: root-managed runtime secrets and tunnel token
- `/var/lib/buzzrouter/postgres`: PostgreSQL data
- `/var/backups/buzzrouter`: local PostgreSQL dumps

Verified pushes to `main` start `buzzrouter-deploy.service` through the
restricted production GitHub Actions runner. A new revision is built and
migrated before Compose replaces the running web container. The web origin is
exposed only on `127.0.0.1:13100`; public traffic arrives through the dedicated
Cloudflare Tunnel.

`buzzrouter-github-discovery.timer` runs a bounded GitHub code search every six
hours. A rate-limited Trusty Squire egress grant gives a disposable one-shot
container access to the GitHub API without exposing the underlying read-only
GitHub credential. Candidate URLs remain private until the normal strict Buzz
relay probe succeeds.

`buzzrouter-nip66-discovery.timer` runs hourly in a disposable one-shot
container. It remains fail-closed until `NIP66_SOURCE_RELAYS` contains 1-10
operator-reviewed public WSS relays and `NIP66_MONITOR_PUBKEYS` contains 2-100
distinct, independently operated 64-character hex monitor pubkeys. Keep
`DISCOVERY_NIP66_ENABLED=false` in this deployment when the host timer is
enabled; the advisory lock prevents overlap, but only one scheduler should own
normal operation.

After adding both allowlists to `/etc/buzzrouter/runtime.env`, install the
checked-in units and enable the timer:

```bash
sudo install -m 0644 \
  deploy/self-host/systemd/buzzrouter-nip66-discovery.service \
  deploy/self-host/systemd/buzzrouter-nip66-discovery.timer \
  /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now buzzrouter-nip66-discovery.timer
sudo systemctl start buzzrouter-nip66-discovery.service
```

Local dumps protect against application and operator errors, but not loss of
the host or its two-device linear LVM volume. Configure encrypted off-host
backup replication before treating this host as the only durable copy of
user-owned data.
