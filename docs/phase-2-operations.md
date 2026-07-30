# Phase 2 Automatic Discovery Operations

Status: Implemented and locally integration-verified

Date: 2026-07-30

## Purpose

Phase 2 discovers candidate Buzz relays from public GitHub references, signed
NIP-66 monitor events, and signed NIP-65 relay lists. Every source remains a
hint until the Phase 1 direct probe verifies the relay. Discovery does not make
a community public.

## Source configuration

All automatic sources default to disabled.

```bash
DISCOVERY_GITHUB_ENABLED=true
GITHUB_TOKEN=<fine-grained token with public repository read access>

DISCOVERY_NIP66_ENABLED=true
NIP66_SOURCE_RELAYS=wss://relay-one.example,wss://relay-two.example
NIP66_MONITOR_PUBKEYS=<64-hex-pubkey>,<64-hex-pubkey>

DISCOVERY_NIP65_ENABLED=true
NIP65_SOURCE_RELAYS=wss://relay-one.example
NIP65_AUTHORS=<64-hex-pubkey>

INTERNAL_REVIEW_PASSWORD=<long random password>
```

`NIP66_MONITOR_PUBKEYS` requires at least two independently operated monitors.
`NIP65_AUTHORS` is an explicit allowlist; broad author scanning is not
supported. Source relay URLs must use `wss`, pass public-address DNS
preflight, and be explicitly configured by the operator.

The configured Nostr source relays are a trust boundary. The current
`nostr-tools` connection performs its own DNS lookup after BuzzRouter's
preflight rather than accepting a pinned address. Use stable, operator-reviewed
source relays until that library boundary can be replaced with a pinned
transport.

## Run

Apply both migrations and start the worker:

```bash
npm run db:migrate
npm run discovery:doctor
npm run worker
```

The worker registers these UTC schedules:

| Source | Schedule | Per-run bound |
| --- | --- | --- |
| GitHub | Every 6 hours | 3 pages of 100 results |
| NIP-66 | Hourly | 1,000 events, 1,000 candidates |
| NIP-65 | Daily | 500 events, 20 relay tags per event |

Queue an immediate pass without changing the recurring schedules:

```bash
npm run discovery:reconcile
```

The command only enqueues jobs. A worker must be running to process them.

Self-hosted production can instead run NIP-66 as a disposable one-shot
container:

```bash
npm run discovery:nip66
deploy/self-host/discover-nip66.sh
```

Install and enable
`deploy/self-host/systemd/buzzrouter-nip66-discovery.{service,timer}` for the
daily host schedule. In that topology, leave `DISCOVERY_NIP66_ENABLED=false`
so the persistent worker does not also schedule the source. Both paths use the
same validated environment loader and PostgreSQL advisory lock. A concurrent
one-shot exits successfully with a `source_locked` result.

## Evidence handling

- GitHub stores a public repository file locator and one current evidence row
  per repository path.
- NIP-66 stores one current evidence row per signing monitor pubkey.
- NIP-65 stores one current evidence row per signing author pubkey.
- Nostr evidence freshness comes from the signed event `created_at`, not the
  time BuzzRouter happened to read or reread it.
- Extracted URLs are normalized before persistence. Credentials are rejected;
  paths, queries, fragments, and invite capabilities are discarded.
- Raw source bodies, GitHub fragments, Nostr event content, and remote error
  messages are not persisted.
- Candidate probe jobs contain only database UUIDs.

NIP-66 events are accepted only when signed by an allowlisted monitor and their
embedded NIP-11 metadata names the canonical Block Buzz software repository.
NIP-65 evidence is always a candidate hint and never establishes listing
eligibility by itself.

All configured Nostr source relays must explicitly complete with EOSE. The
client applies one aggregate event budget across the relay set and fails the
run on relay errors, timeouts, byte overflow, or event-limit saturation.
Cursors advance only after the complete batch is processed, including valid,
allowlisted signed envelopes whose candidate payload is rejected. The
timestamp boundary remains inclusive so a report arriving later in the same
second is not skipped; stable evidence identity makes boundary rereads
idempotent.

## Review and eligibility

Open `/internal/discovery` over HTTPS. Put the route behind Cloudflare Access
in production. The application also uses HTTP Basic authentication with
username `buzzrouter` and `INTERNAL_REVIEW_PASSWORD` as defense in depth. It
fails closed when the password is absent and sends `no-store` responses.

The review console shows:

- Candidate and verification totals
- Source success or failure state
- Canonical relay origin and technical classification
- Evidence type and independent actor
- Listing eligibility reason
- Five most recent probe results

A technically verified candidate is eligible for a future public listing only
when one of these evidence conditions is met:

- A hosting provider explicitly supplies listing intent
- Two distinct NIP-66 monitor pubkeys report it
- GitHub evidence and one NIP-66 monitor report it

Reviewed seeds and NIP-65 evidence do not satisfy this rule. Phase 2 computes
eligibility for review but does not create or publish a public listing.
Eligibility also requires the latest direct probe to be a successful strict
Buzz verification from the previous 48 hours. NIP-66 evidence expires after
7 days; GitHub and provider-intent evidence expires after 30 days.

## Failure and recovery

Source cursors and aggregate results are stored in
`discovery_source_state`. Successful pages or event batches checkpoint their
cursor. Invalid persisted cursors reset to a bounded source default.
Per-source PostgreSQL advisory locks prevent scheduled, manual, and retry jobs
from reconciling the same source concurrently.

Nostr transport messages are capped at 512 KB, individual retained events at
256 KB, and each query at 8 MB of unique event data. A saturated event count is
reported as `incomplete_results` without processing or checkpointing; widening
or partitioning an allowlist is an operator decision rather than an automatic
unbounded crawl.

Jobs retry twice with exponential delay from five minutes up to one hour.
Stored source failures use enumerated codes such as `rate_limited`,
`incomplete_results`, `invalid_configuration`, and `remote_failed`; remote
response bodies are not stored.

GitHub code search requires authentication, is rate limited, and can report
incomplete results. An incomplete result fails the run instead of advancing
past potentially omitted evidence.

## Verification performed

- TypeScript compilation and production Next.js build
- Signed NIP-65 and NIP-66 parser tests
- GitHub extraction, redaction-boundary, and cursor-boundary tests
- Source configuration, state, eligibility, authentication, and queue tests
- Per-relay Nostr EOSE, failure, and timeout tests
- PostgreSQL migration and database-backed source ingestion
- Protected-route checks for unauthenticated and authenticated requests
- Desktop and mobile browser QA with page-level overflow checks
- Dependency audit

Production still needs managed PostgreSQL, a continuously running worker,
source credentials and allowlists, and an HTTPS deployment of the dynamic
review route. The current public prototype remains static and does not expose
the internal review console.
