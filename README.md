# BuzzRouter

BuzzRouter is a discovery and ranking directory for Buzz communities. The
current product surface is a high-fidelity MVP prototype; Phase 1 adds the safe
technical indexing foundation behind it.

- Live prototype: [buzzrouter.com](https://buzzrouter.com)
- Product definition: [PRODUCT.md](./PRODUCT.md)
- Discovery design:
  [docs/auto-discovery-design.md](./docs/auto-discovery-design.md)
- Phase 1 operations:
  [docs/phase-1-operations.md](./docs/phase-1-operations.md)

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

The frontend remains static and does not require PostgreSQL:

```bash
npm run dev
```

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

## Phase 1 scope

Implemented:

- Candidate, provenance, and probe snapshot schema
- PostgreSQL migration runner and `pg-boss` queue
- UTC due-candidate scheduler with bounded database leases
- Origin-only URL normalization
- DNS and SSRF policy with connection pinning
- Bounded NIP-11 fetch and no-auth WebSocket handshake
- Strict verified/probable/rejected Buzz classifier
- Interactive reviewed intake, database doctor, aggregate status, and seed tools
- Adversarial unit and PostgreSQL integration verification

Not yet implemented:

- GitHub, NIP-65, or NIP-66 automatic source adapters
- Public listing decisions, claims, ratings, or rankings
- Database-backed product views
