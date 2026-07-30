# Self-hosted production

The self-hosted stack runs PostgreSQL, the Next.js web process, and migrations
under Docker Compose. The discovery worker stays disabled until automatic
discovery sources are enabled.

Host paths:

- `/opt/buzzrouter/source`: clean checkout of `main`
- `/opt/buzzrouter/bin`: deployment and backup scripts
- `/etc/buzzrouter`: root-managed runtime secrets
- `/var/lib/buzzrouter/postgres`: PostgreSQL data
- `/var/backups/buzzrouter`: local PostgreSQL dumps

The deployment timer polls the public repository every two minutes. A new
revision is built and migrated before Compose replaces the running web
container. The web origin is exposed on `127.0.0.1:13100` for local health
checks and joins the host's existing `buzz-prod_buzz-net` Docker network.
The existing Caddy service terminates HTTPS and proxies to the private
`buzzrouter-web:3000` network alias.

Local dumps protect against application and operator errors, but not loss of
the host or its two-device linear LVM volume. Configure encrypted off-host
backup replication before treating this host as the only durable copy of
user-owned data.
