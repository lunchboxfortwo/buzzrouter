# Phase 1 Discovery Operations

Status: Implemented, pending deployment database

Date: 2026-07-29

## Purpose

Phase 1 turns reviewed relay origins into repeatable technical classifications.
It does not publish communities, inspect relay events, redeem invites, or infer
private activity.

## Data flow

```text
reviewed relay origin
  -> normalize to wss://host[:port]
  -> persist candidate and public provenance
  -> enqueue candidate UUID
  -> resolve and reject unsafe DNS answers
  -> pin HTTPS /info request to a validated address
  -> parse bounded NIP-11 metadata
  -> resolve again and pin a no-auth WebSocket handshake
  -> classify and persist a probe snapshot
```

The HTTPS and WebSocket steps resolve independently so a DNS change between
connections is re-evaluated.

## Environment

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/buzzrouter
DATABASE_SSL=false
DISCOVERY_SEED_FILE=config/reviewed-relays.json
```

Set `DATABASE_SSL=true` only when the PostgreSQL server presents a certificate
trusted by the host.

## Initialize

1. Create the PostgreSQL database.
2. Apply the BuzzRouter migration:

   ```bash
   npm run db:migrate
   ```

3. Put reviewed canonical origins in `config/reviewed-relays.json`:

   ```json
   {
     "relays": [
       {
         "url": "wss://relay.example.com",
         "sourceLocator": "https://github.com/example/project"
       }
     ]
   }
   ```

4. Seed candidates and enqueue probes:

   ```bash
   npm run discovery:seed
   ```

5. Run the continuously available worker:

   ```bash
   npm run worker
   ```

Run the web process and worker as separate services in production.

## Safety invariants

- Candidate URLs with credentials are rejected.
- Paths, queries, and fragments are removed before candidate persistence.
- Source evidence is HTTPS-only; invite paths, queries, and fragments are
  removed.
- Every A and AAAA answer must be public unicast. One blocked answer rejects the
  whole resolution.
- DNS is resolved again for each outbound connection.
- Redirects and WebSocket per-message compression are disabled.
- NIP-11 responses are limited to 256 KB and requested without compression.
- WebSocket payloads are limited to 1 MB.
- Probe jobs contain only candidate UUIDs.
- Stored failures are enumerated result codes, not remote error bodies.
- Icons are stored as hashes, not copied data URLs.

## Retry behavior

The probe queue allows three total attempts. Failed jobs use exponential delay
starting at two hours and cap at 24 hours. Candidates are scheduled for a daily
reprobe after a stored result.

## Verification performed

- TypeScript compilation
- Production Next.js build
- Unit tests for normalization, source redaction, IP policy, mixed DNS answers,
  NIP-11 parsing, classifier decisions, safe failures, and pinned lookup forms
- Live probe against a public Buzz relay, including NIP-11, TLS, WebSocket, and
  strict classification
- Dependency audit with zero known vulnerabilities

The current development host has no running PostgreSQL service and cannot
access its Docker daemon. The migration and queue lifecycle therefore still
need one integration run against the deployment database before the worker is
enabled.
