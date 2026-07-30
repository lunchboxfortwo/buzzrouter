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

Local dumps protect against application and operator errors, but not loss of
the host or its two-device linear LVM volume. Configure encrypted off-host
backup replication before treating this host as the only durable copy of
user-owned data.
