# Self-hosted production

The self-hosted stack runs PostgreSQL, the Next.js web process, migrations, and
a dedicated Cloudflare Tunnel under Docker Compose. The discovery worker stays
disabled until automatic discovery sources are enabled.

Host paths:

- `/opt/buzzrouter/source`: clean checkout of `main`
- `/opt/buzzrouter/bin`: deployment and backup scripts
- `/etc/buzzrouter`: root-managed runtime secrets and tunnel token
- `/var/lib/buzzrouter/postgres`: PostgreSQL data
- `/var/backups/buzzrouter`: local PostgreSQL dumps

The deployment timer polls the public repository every two minutes. A new
revision is built and migrated before Compose replaces the running web
container. The web origin is exposed only on `127.0.0.1:13100`; public traffic
arrives through the dedicated Cloudflare Tunnel.

Local dumps protect against application and operator errors, but not loss of
the host or its two-device linear LVM volume. Configure encrypted off-host
backup replication before treating this host as the only durable copy of
user-owned data.
