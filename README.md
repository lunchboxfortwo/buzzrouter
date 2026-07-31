# BuzzRouter

BuzzRouter is a discovery and ranking directory for Buzz communities. The
current product surface is a high-fidelity MVP prototype; Phases 1 through 3
add the safe technical index, automatic discovery sources, internal review,
community ownership claims, and public listing foundations behind it.

- Live prototype: [buzzrouter.com](https://buzzrouter.com)
- Product definition: [PRODUCT.md](./PRODUCT.md)
- Discovery design:
  [docs/auto-discovery-design.md](./docs/auto-discovery-design.md)
- Phase 1 operations:
  [docs/phase-1-operations.md](./docs/phase-1-operations.md)
- Phase 2 operations:
  [docs/phase-2-operations.md](./docs/phase-2-operations.md)
- Phase 3 operations:
  [docs/phase-3-operations.md](./docs/phase-3-operations.md)

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

The prototype route remains static. Claim, listing, and internal review routes
require PostgreSQL and the environment described in the operations guides:

```bash
npm run dev
```

## Public API

`GET /api/communities` returns the verified, listed directory communities as
JSON — no auth required. It reuses the same read the directory page uses
(`listDirectoryCommunities` in `src/db/directory.ts`), so it never exposes
more than the public listing already does: no owner pubkeys, claim tokens, or
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
- Cursor-backed GitHub code search with immediate invite-path redaction
- Signed NIP-66 monitor ingestion and signed NIP-65 relay-list hints
- Per-source health state, bounded schedules, and manual reconciliation
- Independent-source listing eligibility evaluation
- Basic-auth protected candidate review with evidence and probe history
- NIP-98 request authentication with one-use replay protection
- DNS TXT, HTTPS file, and hosted-relay icon ownership proofs
- Conflict-safe ownership state and public listing metadata
- NIP-07 claim workspace and database-backed community detail pages
- Adversarial unit and PostgreSQL integration verification

Not yet implemented:

- Directory integration for database-backed listings
- Community ratings, popularity signals, or rankings
- Provider-mediated claims and dispute resolution operations
- A managed runtime for the dynamic application and discovery worker
