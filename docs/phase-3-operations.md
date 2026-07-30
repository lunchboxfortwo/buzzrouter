# Phase 3 Community Claims and Listings

Status: Implemented and locally integration-verified

Date: 2026-07-30

## Purpose

Phase 3 lets an operator prove control of a verified Buzz relay, administer one
listing with a Nostr identity, and publish a database-backed community detail
page. It does not introduce a separate Buzz name system.

## Runtime configuration

Apply all migrations and configure the public origin:

```bash
DATABASE_URL=postgresql://...
DATABASE_SSL=true
PUBLIC_APP_ORIGIN=https://buzzrouter.com
```

`PUBLIC_APP_ORIGIN` is part of the NIP-98 trust boundary. Production accepts
only a credential-free HTTPS origin with no path, query, or fragment. Signed
request URLs must match this configured origin exactly, regardless of proxy or
host headers.

The claim and public listing routes require a Node.js runtime with PostgreSQL.
Production runs the Next.js web process and the discovery worker as separate
Fly.io process groups. A release command applies migrations before a rolling
web deployment.

## Claim flow

An eligible relay has a recent strict Buzz probe. Its claim workspace is:

```text
/claim/<candidate-uuid>
```

The operator connects a NIP-07 signer. Each mutation uses a signed NIP-98 kind
27235 event containing the exact public URL, method, and SHA-256 payload tag.
Events older than 60 seconds are rejected, and every accepted event ID is
stored once to prevent replay.

The server issues a random 256-bit challenge that expires after 15 minutes and
permits at most 10 verification attempts. Only the token hash is stored.
Creating a new challenge expires the claimant's previous pending challenge.

## Proof methods

Self-hosted relays offer either proof:

- DNS TXT at `_buzzrouter.<relay-host>` with
  `buzzrouter-claim=<challenge-token>`
- HTTPS JSON at `https://<relay-host>/.well-known/buzzrouter.json` containing
  the exact challenge nonce and claimant pubkey

Relays hosted at `*.communities.buzz.xyz` use the NIP-11 icon field. The
operator temporarily sets it to the token-gated PNG URL shown in the claim
workspace.

HTTPS proof retrieval reuses the discovery network policy: public-address DNS
preflight, connection pinning, valid TLS, no redirects, a five-second total
deadline, and a 64 KB response limit. Hosted icon verification performs a fresh
bounded NIP-11 fetch. DNS responses are bounded by record count and total size.

## Ownership and disputes

The first successful control proof establishes the Nostr owner. PostgreSQL row
locking prevents two concurrent first claims from both winning.

A later proof from the same pubkey refreshes ownership. A valid proof from a
different pubkey creates a disputed claim, changes the community to `disputed`,
and immediately makes any public listing internal. Resolving disputes,
revocation, and provider-mediated recovery remain operator procedures for a
later phase.

## Listing publication

Only the verified owner can update listing metadata. Public listings require:

- A unique lowercase slug
- Display name and description
- Up to five normalized categories
- An invite-required, request-invite, or public-link join mode
- A valid HTTPS join URL for non-invite-only modes
- A successful strict Buzz probe from the previous 48 hours

Public pages are available at `/communities/<slug>`. They stop resolving when
ownership is disputed, the candidate is no longer verified, or the latest
strict probe becomes stale.

## Verification performed

- 135 unit tests, TypeScript compilation, and dependency audit
- Three migrations applied to a clean PostgreSQL database and rerun idempotently
- Database-backed claim, publication, replay, and dispute transitions
- Production Next.js build covering all dynamic routes
- Unauthenticated API, invalid icon token, and protected review route checks
- Desktop and mobile browser QA for claim and public detail pages
- No browser console errors on tested pages

The Fly.io release workflow runs the complete verification suite, applies
migrations, deploys both process groups, and verifies the database-backed
health endpoint before declaring the release successful.
