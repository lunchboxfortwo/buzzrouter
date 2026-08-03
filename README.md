# BuzzRouter

BuzzRouter is a discovery and ranking directory for Buzz communities. The
current product surface includes the safe technical index, automatic discovery
sources, internal review, public listing foundations, and invite-driven Link
flow.

- Live prototype: [buzzrouter.com](https://buzzrouter.com)
- Product definition: [PRODUCT.md](./PRODUCT.md)
- Discovery design:
  [docs/auto-discovery-design.md](./docs/auto-discovery-design.md)
- Phase 1 operations:
  [docs/phase-1-operations.md](./docs/phase-1-operations.md)
- Phase 2 operations:
  [docs/phase-2-operations.md](./docs/phase-2-operations.md)

## Development

Requirements:

- Node.js 22.12 or newer
- PostgreSQL 14 or newer for discovery jobs

```bash
npm install
npm test
npm run typecheck
npm run build
```

The directory, Link, submission, and internal review routes require PostgreSQL
and the environment described in the operations guides:

```bash
npm run dev
```

### Pair Buzz on an Android emulator

With an existing emulator running and the Buzz Android app installed, pair it
to a fresh throwaway identity without building Buzz desktop:

```bash
node --import tsx scripts/pair-android-buzz.ts \
  --identity-relay https://buzzdir.communities.buzz.xyz \
  --serial emulator-5554 \
  --evidence-dir /tmp/buzz-pair-evidence
```

The script implements the desktop side of Buzz's NIP-AB pairing protocol. It
creates the identity and pairing keys in memory, authenticates to the pairing
relay, drives the installed app through `adb`, confirms the matching safety
code, and optionally writes a post-pairing screenshot. It never prints the
identity secret, pairing URI, session secret, ciphertext, or receipt. Use only
a disposable identity relay and emulator; do not pass a production bridge key.

## Public API

`GET /api/communities` returns the verified, listed directory communities as
JSON — no auth required. It reuses the same read the directory page uses
(`listDirectoryCommunities` in `src/db/directory.ts`), so it never exposes
more than the public listing already does: no owner pubkeys, invite tokens, or
connector/install secrets.

- `?joinable=true` returns only communities that have an invite code or
  public URL.
- `?limit=N` bounds the result count (default 100, hard maximum 200).
- Responses are cached publicly for 5 minutes
  (`cache-control: public, max-age=300, stale-while-revalidate=3600`) since
  the directory only changes on the discovery worker's cadence, not per
  request.

## Discovery worker

Create local environment and reviewed-relay files, then:

```bash
cp .env.example .env.local
cp config/reviewed-relays.example.json config/reviewed-relays.json
npm run db:migrate
npm run discovery:doctor
npm run discovery:add
npm run discovery:seed
npm run worker
```

Only canonical relay origins should be added to
`config/reviewed-relays.json`. That file is intentionally ignored by Git.
Candidate jobs contain database IDs rather than arbitrary URLs.

`npm run discovery:add` accepts relay or invite URLs interactively and rewrites
them to canonical origins before the ignored file is saved. Once the worker is
running, `npm run discovery:status` prints aggregate candidate and probe health
without exposing relay URLs.

Automatic sources are opt-in. Configure the Phase 2 environment variables,
start the worker, then enqueue an immediate run with:

```bash
npm run discovery:reconcile
```

The worker schedules each automatic discovery source once daily. The protected
review console is available at `/internal/discovery` when
`INTERNAL_REVIEW_PASSWORD` is set.

## Implemented discovery scope

Implemented:

- Candidate, provenance, and probe snapshot schema
- PostgreSQL migration runner and `pg-boss` queue
- UTC due-candidate scheduler with bounded database leases
- Origin-only URL normalization
- DNS and SSRF policy with connection pinning
- Bounded NIP-11 fetch and no-auth WebSocket handshake
- Strict verified/probable/rejected Buzz classifier
- Interactive reviewed intake, database doctor, aggregate status, and seed tools
- Cursor-backed GitHub code search that harvests validated, relay-host-matched
  invite codes while keeping invite paths out of source locators and logs
- Signed NIP-66 monitor ingestion and signed NIP-65 relay-list hints
- Per-source health state, bounded schedules, and manual reconciliation
- Independent-source listing eligibility evaluation
- Basic-auth protected candidate review with evidence and probe history
- NIP-98 request authentication with one-use replay protection
- Invite-driven community admission for shared-channel linking
- Database-backed community detail pages
- Adversarial unit and PostgreSQL integration verification

Not yet implemented:

- Directory integration for database-backed listings
- Community ratings, popularity signals, or rankings
- A managed runtime for the dynamic application and discovery worker
