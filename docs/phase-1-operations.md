# Phase 1 Discovery Operations

Status: Implemented and locally integration-verified

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
   npm run discovery:doctor
   ```

3. Create the ignored local seed file:

   ```bash
   cp config/reviewed-relays.example.json config/reviewed-relays.json
   ```

4. Add candidates interactively:

   ```bash
   npm run discovery:add
   ```

   The command accepts a relay or invite URL and an optional public source URL.
   It stores only the canonical relay origin and redacted source locator.

   The resulting `config/reviewed-relays.json` has this shape:

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

5. Seed candidates and enqueue probes:

   ```bash
   npm run discovery:seed
   ```

6. Run the continuously available worker:

   ```bash
   npm run worker
   ```

Run the web process and worker as separate services in production.

## Observe

Run:

```bash
npm run discovery:status
```

The command returns candidate counts by state, the number currently due, probe
and failure counts for the previous 24 hours, and the latest probe timestamp.
It does not return relay hosts or source locators.

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
- The reviewed-relay file is ignored by Git.
- Worker and seed startup fail before queue registration when the application
  migration is missing.
- Stored failures are enumerated result codes, not remote error bodies.
- Icons are stored as hashes, not copied data URLs.

## Retry behavior

The probe queue allows three total attempts. Failed jobs use exponential delay
starting at two hours and cap at 24 hours. A UTC scheduler runs every 15
minutes, leases due candidates, and queues UUID-only jobs. Candidates are
scheduled for a daily reprobe after a stored result. A transient network failure
does not erase a prior verified or probable classification.

## Verification performed

- TypeScript compilation
- Production Next.js build
- Unit tests for normalization, source redaction, IP policy, mixed DNS answers,
  NIP-11 parsing, classifier decisions, safe failures, and pinned lookup forms
- Live probe against a public Buzz relay, including NIP-11, TLS, WebSocket, and
  strict classification
- PostgreSQL 16 migration, readiness doctor, reviewed seed, and aggregate
  status commands
- `pg-boss` initial probe plus a forced due-candidate scheduler cycle and
  successful recurring probe
- Dependency audit with zero known vulnerabilities

The integration run used an isolated loopback-only PostgreSQL cluster under
`/tmp`. Production still needs its own managed PostgreSQL connection and
service-level worker deployment.
