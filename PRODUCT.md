# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is someone exploring the Buzz ecosystem who wants to find a
useful community without already knowing its relay address. Visitors compare
communities by name, purpose, category, public evidence, and verification
freshness before opening or joining one in Buzz.

This audience currently skews toward developers, builders, creators, Bitcoin
communities, privacy communities, and people working with agents. They expect a
quiet, credible product with the information density and precision of serious
developer tools.

Community operators are the secondary user. They can submit a relay or invite URL,
claim a verified listing, publish bounded metadata, and provide a direct public
join path without controlling BuzzRouter's independent technical evidence.

## Product Purpose

BuzzRouter is the public discovery layer for Buzz communities. It converts
relay-based spaces into a legible directory where people can:

- Search by community name, description, or category.
- Filter by category.
- Read a one-line explanation before opening a listing.
- Inspect direct relay and discovery evidence.
- Open or join the community in Buzz.

The MVP succeeds when a first-time visitor can understand what several communities
do and make a confident join decision in a few minutes.

## Positioning

BuzzRouter's differentiator is first-hand relay verification attached to
multi-source discovery. The service contacts candidate relays directly with a
bounded NIP-11 request and no-auth WebSocket handshake before a community becomes
public. It does not treat a submitted form, catalog entry, or monitor report as
proof that a relay is a working Buzz community.

The directory combines that direct check with attributed discovery evidence from
public catalogs, GitHub references, signed Nostr events, reviewed seeds, and user
submissions. Discovery evidence explains how BuzzRouter found a community;
verification establishes that the current relay satisfies the listing standard.

## Current Product

The public directory at `app/page.tsx` is a database-backed React Server Component.
It reads verified communities from PostgreSQL on every request. There is no static
prototype or placeholder directory in the serving path.

The shipped directory provides:

- A two-route masthead: `Discover` and `Submit`.
- Community and category totals for the current result set.
- Search across display name, one-line description, and category tags.
- Category filtering across Bitcoin, Builders, Culture, GTM, Labs, and Privacy.
- Evidence-strength and recently-verified sorting.
- Compact result rows with a community logo or monogram, name, primary category,
  one-line description, verification state, and evidence count.
- A persistent detail panel with description, categories, join action, claim
  action, latest verification, handshake timing, access mode, evidence sources,
  and protocol profile.
- Empty and no-result states that keep the next action explicit.

The submission route accepts a public relay, HTTPS community URL, or shared Buzz
invite URL. Invite capability tokens were formerly redacted; as of the join-links work they are retained in a labelled column so the directory can hand a joinable target to the Buzz app. Invite paths inside arbitrary source locators are
discarded before persistence. A submission enters the normal discovery and
verification pipeline; it does not publish immediately.

Verified operators can claim listings and publish bounded display metadata,
categories, slugs, and public join configuration. Claimed communities can have a
dedicated public profile route.

## Discovery and Publication

Discovery sources run once daily. Production currently uses:

- The public Buzzdir catalog as attributed listing metadata.
- Bounded GitHub code search for public Buzz relay references.
- Signed NIP-66 monitor events from reviewed monitors and source relays.
- Signed NIP-65 relay-list hints when enabled.
- Reviewed seed records and public submissions.

All discovered URLs are normalized to canonical relay origins before storage.
Network probes enforce DNS and SSRF policy with connection pinning, strict TLS,
small response limits, and short timeouts.

A community is visible only when its candidate state is `verified_buzz` and its
latest successful direct verification is no more than 48 hours old. Discovery
sources cannot bypass this requirement.

NIP-11 descriptions may provide fallback copy. Public Buzzdir metadata or
operator-claimed metadata can provide a more useful display name, description,
and category set. Relay-provided logos are accepted only as bounded PNG, JPEG,
WebP, or GIF data URIs with matching file signatures. BuzzRouter stores and serves
those bytes from a first-party endpoint; it does not hotlink arbitrary remote
images. Listings without a safe logo use a monogram.

## Popularity and Ranking

Popularity, trust, and activity are separate product concepts:

- **Trust** determines whether a listing is eligible and explains its evidence.
- **Popularity** will measure demonstrated visitor demand.
- **Activity** would describe comparable community participation if a
  privacy-safe and representative source becomes available.

The current product does not claim to measure popularity. `Strongest evidence`
sorts by evidence count and verification freshness; it is not a popularity score.
Ratings, stars, review counts, and popularity labels are not shipped.

The planned first popularity model uses 30 days of first-party demand:

- 65% unique join intents.
- 25% unique detail viewers.
- 10% authenticated endorsements.

Signals will be deduplicated with rotating keyed fingerprints, log-scaled, and
time-decayed with a 14-day half-life. Raw IP addresses and full user-agent strings
will not be stored. A `Popular` sort will not ship until at least 30 days of data
has been reviewed for bots and obvious manipulation. The full methodology lives
in `docs/popularity-signals.md`.

## Operating Context

Production is a self-hosted Docker Compose stack on the current host. It runs
PostgreSQL, migrations, the Next.js web process, the discovery worker, and a
Cloudflare Tunnel. Public traffic reaches `buzzrouter.com` through the tunnel;
the web origin listens only on localhost.

Pushes to `main` run the GitHub Actions verification suite and then deploy through
a restricted self-hosted runner. Deployment applies migrations before replacing
the web and worker containers and verifies the exact release SHA through
`/api/health`.

The discovery worker uses PostgreSQL and `pg-boss` for durable queues, bounded
leases, retries, and recurring source schedules. Operators also have a
password-protected review surface at `/internal/discovery` and CLI tools for
source reconciliation, intake, health checks, aggregate status, and seeding.

## Capabilities and Constraints

Requires Node.js 22.12 or newer and PostgreSQL 14 or newer. The public directory
requires a migrated PostgreSQL database and is dynamically rendered.

Implemented:

- Database-backed public directory and community detail selection.
- Automatic discovery, provenance, direct verification, and source health.
- Daily source reconciliation and daily candidate reprobes.
- Safe first-party community logo ingestion and serving.
- Public submission intake with invite-capability redaction.
- Operator claim and listing metadata workflows.
- Internal evidence review and operational tooling.
- Self-hosted continuous deployment to `buzzrouter.com`.

Not yet implemented:

- Popularity telemetry or a `Popular` sort.
- Public ratings or reviews.
- A representative cross-community activity metric.
- Open-ended or automatically inferred category creation.
- Personalized recommendations.

## Brand Personality

Credible, restrained, and precise. BuzzRouter should feel native to Linear- and
GitHub-adjacent workflows: calm under density, explicit about evidence, and
confident without promotional gloss.

## Anti-references

Avoid speculative crypto aesthetics, neon-on-black palettes, token dashboards,
oversized marketing heroes, social-feed engagement bait, decorative gradients,
generic card-heavy SaaS landing pages, and fabricated metrics. Popularity must
never be presented as a substitute for quality or verification.

## Brand Commitments

The BuzzRouter name and wordmark are binding identity elements. The logo at
`public/assets/brand/buzzrouter-logo.png` is used in the masthead and favicon.
Preserve its circular crop and proportions rather than restyling it as a generic
interface icon.

## Evidence on Hand

Real:

- The live public directory at `buzzrouter.com`.
- Verified public community records backed by current probe snapshots.
- Attributed Buzzdir, GitHub, NIP-66, NIP-65, reviewed, and submission evidence.
- Direct relay metadata, protocol support, handshake timing, and verification
  timestamps.
- Safe relay-provided logos for communities that publish them.

Absent - do not fabricate:

- Popularity or engagement history.
- Ratings, reviews, endorsements, testimonials, or customer claims.
- Community membership counts or comparable message-volume statistics.
- Pricing, revenue, or marketplace liquidity.

## Product Principles

1. Evidence before enthusiasm. Separate public claims from independently observed
   facts.
2. Make purpose legible. Every result should explain what the community does
   without requiring a detail-page visit.
3. Make comparison effortless. Keep row metadata consistent and scannable.
4. Explain every ranking. Do not relabel evidence, freshness, or uptime as
   popularity.
5. Join through Buzz. BuzzRouter discovers and routes; it does not replace native
   spaces.
6. Earn density. Show useful information without decorative noise.

## Accessibility and Inclusion

Target WCAG 2.2 AA. Support keyboard navigation, visible focus states, semantic
landmarks, sufficient contrast, responsive layouts, and status communication that
does not rely on color alone.
