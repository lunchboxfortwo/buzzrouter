# Product

<!-- impeccable:product-schema 1 -->

## Register

product

## Platform

web

## Users

People exploring the Buzz ecosystem who want to find active, credible communities
without already knowing where to look. They are comparing communities by purpose,
quality, popularity, and recent activity before deciding whether to join.

Confirmed 2026-07-30: this audience skews toward developers and builders working in
and around agentic coding. They are looking for both agent-tooling communities and
human communities, and they arrive with the taste and scepticism of people who use
serious technical tools daily. The directory's existing "Agent tools" focus area
reflects this.

Community operators are a secondary user. They need a straightforward way to list
their community, explain what it does, and build reputation through verifiable
participation rather than promotional claims.

## Product Purpose

BuzzRouter is the public discovery, ranking, and reputation layer for Buzz
communities. It turns relay-based spaces into a legible directory where people can
browse categories, compare quality signals, inspect community details, and join
through the community's native relay URL.

The MVP succeeds when a first-time visitor can find a relevant, trustworthy
community and make a confident join decision in a few minutes.

## Positioning

First-hand relay probe evidence. BuzzRouter reaches communities directly — bounded
NIP-11 document fetches and no-auth WebSocket handshakes — and attaches the
resulting activity and health observations to each listing. A directory built on
submitted forms or scraped listings cannot truthfully make the same claim, because
the evidence is produced by BuzzRouter's own contact with the relay rather than
reported by the community.

Supporting mechanisms exist but are not the differentiating claim: independent
multi-source eligibility (GitHub code search, signed NIP-66 monitor ingestion,
signed NIP-65 relay-list hints), transparent ranking explanation, and internal
human review before listing.

## Operating Context

The public directory is read by visitors comparing communities before joining;
joining happens in the community's own Buzz space, not in BuzzRouter.

Behind it runs a discovery pipeline: a PostgreSQL-backed candidate index with a
`pg-boss` queue, a UTC due-candidate scheduler with bounded database leases, and a
worker (`npm run worker`) that probes candidates under a DNS and SSRF policy with
connection pinning. Automatic sources are opt-in and scheduled once daily, with
manual reconciliation available. Operators
work through a basic-auth protected review console at `/internal/discovery`, plus
CLI tools for intake, doctor checks, aggregate status, and seeding.

Relay URLs are handled as sensitive operational data: `config/reviewed-relays.json`
is deliberately Git-ignored, candidate jobs carry database IDs rather than arbitrary
URLs, invite paths are redacted immediately on ingestion, and status tooling reports
aggregates without exposing relay URLs.

## Capabilities and Constraints

Requires Node.js 22.12+ and PostgreSQL 14+ for discovery jobs. The frontend is
static and runs without PostgreSQL.

Implemented: candidate/provenance/probe schema, migration runner and queue,
scheduler with bounded leases, origin-only URL normalization, DNS and SSRF policy,
bounded NIP-11 fetch and no-auth WebSocket handshake, strict
verified/probable/rejected Buzz classifier, reviewed intake and operational CLIs,
cursor-backed GitHub code search with invite redaction, signed NIP-66 and NIP-65
ingestion, per-source health and bounded schedules, independent-source listing
eligibility, protected candidate review with evidence and probe history, and
adversarial unit plus PostgreSQL integration verification.

Not yet implemented: public listing persistence or automatic publication; community
claims, ratings, or rankings; database-backed product views.

Frontend delivery is split. The internal review console is a React Server Component
in `app/` reading Postgres directly. The public directory is a static prototype —
`app/page.tsx` redirects to `public/prototype.html` with `prototype.css` and
`prototype.js`. Confirmed decision (2026-07-30): public-directory work continues in
the static prototype for now; the React port is expected to be necessary eventually
(database-backed views and server-rendered listings) but is deferred until listing
persistence exists, since there is no real data to bind to. Design work is expected
to carry forward rather than be discarded at that port.

## Brand Personality

Credible, restrained, precise. The interface should feel native to serious
developer tools such as Linear and GitHub: calm under density, explicit about how
rankings work, and confident without promotional gloss.

## Anti-references

Avoid speculative crypto aesthetics, neon-on-black palettes, token dashboards,
oversized marketing heroes, social-feed engagement bait, decorative gradients,
and generic card-heavy SaaS landing pages. Popularity must never be presented as a
substitute for quality.

## Brand Commitments

The BuzzRouter name and wordmark. The logo at `public/assets/brand/buzzrouter-logo.png`
is a binding identity asset used in the masthead and as the favicon, and is to be
preserved at its shipped circular proportions rather than restyled as a generic icon.
The Brand Personality and Anti-references above are binding.

## Evidence on Hand

Real: the BuzzRouter name and logo asset; a live prototype at
[buzzrouter.com](https://buzzrouter.com); the discovery pipeline's own probe and
provenance records, held in PostgreSQL and visible only in the protected internal
review console.

Illustrative only: every community, category, rating, activity figure, freshness
value, and rank shown in the public directory is invented placeholder data. The
surface currently marks this with a "Preview" status control and an "Example rank"
sort option. Future work must continue to label this data as illustrative and must
never present it as real observation.

Absent — do not fabricate: there are no real public listings, no testimonials,
customers, endorsements, press, benchmarks, user counts, pricing, or licensing
claims. No community has been publicly published through the pipeline.

## Product Principles

1. Evidence before enthusiasm. Put ratings, activity, and provenance beside claims.
2. Make comparison effortless. Keep community metadata consistent and scannable.
3. Explain the ranking. Users should understand why a community appears where it does.
4. Join through Buzz. BuzzRouter discovers and routes; it does not replace native spaces.
5. Earn density. Show useful information without adding visual noise.

## Accessibility & Inclusion

Target WCAG 2.2 AA. Support keyboard navigation, visible focus states, semantic
landmarks, sufficient contrast, reduced motion, and status communication that does
not rely on color alone.
