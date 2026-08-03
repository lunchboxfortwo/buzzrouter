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

Community operators are the secondary user. They can submit a relay or invite
URL, provide listing context during intake, and link verified communities by
pasting an owner/admin invite without controlling BuzzRouter's independent
technical evidence.

## Product Purpose

BuzzRouter is the connective tissue of the Buzz ecosystem: the place you
discover Buzz communities, join them, and connect them to each other. Buzz
spaces are independent relays that do not know about one another; BuzzRouter is
what stitches them into one legible whole.

It does NOT create communities. Buzz desktop already does that well, and
Builderlab's auth only accepts a loopback callback, so a website structurally
cannot. Removed 2026-08-02.

Three surfaces:

- **Discover** — the verified directory. Converts relay-based spaces into a
  legible directory where people can search by name, description, or
  category; filter by category; read a one-line explanation before opening a
  listing; inspect direct relay and discovery evidence; and open or join the
  community in Buzz.
- **List** (`/submit`) — a community owner submits a relay, community URL, or
  invite for verification and listing.
- **Connect** (`/shared-channels`) — a community connects one local channel to the
  **open BuzzRouter channel** and reaches every permitted hub community.
  BuzzRouter mirrors messages with visible attribution.

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

- A three-route masthead: `Discover`, `Connect`, and `List`; directory
  search appears only on Discover.
- Community and category totals for the current result set.
- Search across display name, one-line description, and category tags.
- Direct Focus filtering across Bitcoin, Builders, Culture, GTM, Labs, and
  Privacy.
- Evidence-strength and recently-verified sorting.
- Compact result rows with a community logo or monogram, name, primary category,
  one-line description, verification state, and evidence count.
- A persistent detail panel with description, categories, join action, latest
  verification, handshake timing, access mode, evidence sources,
  and protocol profile.
- Empty and no-result states that keep the next action explicit.

The submission route accepts a public relay, HTTPS community URL, or shared Buzz
invite URL. Invite capability tokens were formerly redacted; as of the join-links work they are retained in a labelled column so the directory can hand a joinable target to the Buzz app. Invite paths inside arbitrary source locators are
discarded before persistence. A submission enters the normal discovery and
verification pipeline; it does not publish immediately.

Operators submit listing context during intake. Directory metadata remains
independent of Connect authorization; connecting uses an owner/admin invite.

## The Pitch: The Open Hub Is the Product

One line: **discover, join, and connect with other Buzz communities.** The thing
people need to understand is that BuzzRouter connects communities through one
open hub. Discovery exists so you can see who already participates.

Longer horizon: this messaging layer is meant to be TCP for a productive economy
built on Buzz. Guilds are workflows for human-AI and multi-agent collaboration,
so a community should be able to post a request for digital work into another
community and get it back.

### The rule that follows: no semantics in the layer

TCP's virtue is that it is dumb and refuses to care what it carries. So the
transport must NOT learn what a "request for work" is. No request types, no job
schemas, no work-order fields, no status enums, no reputation. The moment the
layer understands one application, it stops being substrate and becomes one
opinionated app everything else routes around. Semantics belong above.

### Provenance is a committed interface, not an implementation detail

A mirrored message is re-signed by the BuzzRouter bridge, so the sender's own
signature does not survive to the destination. For chat that is acceptable. For
work requests — who asked, who delivered — it is not.

We therefore preserve the original provenance in tags on every projected event:

- `["br", "source-community", <community id>]`
- `["br", "source-event", <original event id>]`
- `["br", "source-actor", <original author pubkey>]`

That is enough for a layer above to verify independently: fetch the original
event from the source relay and check its signature. **Treat these tags as a
public contract.** Renaming or dropping them breaks every future thing built on
this, even though nothing today reads them.

## The Open BuzzRouter Channel

The BuzzRouter community IS the product's connective tissue, not a demo of it.
A community links once to the hub and reaches every community that opted in to
receive, instead of negotiating a separate pair with each one.

**Why the hub and not bilateral.** Bilateral has never been completed once:
production has 1 community connection and 0 shared-channel endpoints, ever. The
hub is also the only surface BuzzRouter controls end to end — we operate
`relay.buzzrouter.com`, so we can fix things there that we cannot fix anywhere
else. Everything currently blocking the product is blocked on Block; the hub is
not.

**Consent is the design, not a second ceremony.** Pasting an owner/admin invite
and joining the open channel turns sending and receiving on. The link step says
plainly that other hub communities' messages will appear in the chosen channel.
Each community can later turn either direction off and choose one blocklist or
allowlist that bounds which other hub communities it exchanges traffic with.

Connect uses one searchable channel control. An owner can filter the relay's
existing channels or type an unmatched name and choose an explicit `Create
#channel` action. Creation is never inferred from an empty search result. A new
channel is created by the bridge, transferred to a real owner or admin from the
relay-signed roster, and only then bound to the hub; the bridge ends as a plain
member. The three relay writes are journaled so a retry resumes an incomplete
handoff instead of creating another channel or leaving the bridge as owner.

The owner session is intentionally short-lived. Pasting another valid
owner/admin invite for an already-connected community validates it with the
existing bridge, mints a fresh session, and returns the owner to that
community's settings without creating a duplicate connection.

There is no separate bilateral mechanism. A community that wants a private pair
selects `only_these` and puts one community in its filter list. This
deliberately gives up the old two-owner acceptance handshake in favor of the
hub's disclosed, owner-invited, open-by-default model.

### Decisions (2026-08-02)

- The hub is the only connection model; a one-community allowlist is a private
  pair without a second protocol.
- Joining a community must land the joiner in a channel. We can guarantee this
  on our own relay and nowhere else (see `block/buzz#4307`).
- Send and receive are on by default after the disclosed owner-level link.
  They remain separate switches.
- Attribution is always visible on a mirrored message.

### Open questions

- Running the hub means operating a community: moderation, abuse, someone's
  3am. Is that a business we want, or does the hub stay routing fabric that
  nobody chats in?
- Reach is bounded by communities we can actually join — 18 of 61 today, since
  the rest publish no invite code.

## Agents

BuzzRouter operates two distinct Nostr identities against Buzz relays. They
are not interchangeable, and the difference is a trust boundary, not an
implementation detail:

- **The bridge** (`src/shared-channels/`) exists only to carry hub traffic.
  It joins a community's relay only after being explicitly invited or
  admitted by an owner/admin, gets a freshly generated keypair per connection,
  and subscribes to exactly one hub-mapped channel (a `#h`-tag filter
  scoped to that channel's ID — see `src/shared-channels/connector.ts`). It
  runs no LLM and does not summarize, interpret, or act on what it reads; it
  mirrors message content verbatim, re-signed under its own identity with
  attribution tags. It cannot see any channel not selected during Connect,
  and it cannot see communities it was never admitted into at all.
- **The presence agent** (`src/presence/`, plus the jobs in
  `src/jobs/auto-join-communities.ts`, `harvest-invites.ts`, and
  `refresh-community-summaries.ts`) is a single shared identity
  (`.secrets/buzz-agent.identity.json` / `BUZZ_AGENT_KEY`) that joins any
  community the public directory lists as joinable, on a recurring schedule.
  It reads community messages and sends them to an LLM to derive a
  directory-facing activity summary — goals, recent projects, a focus
  category, and a deterministically computed activity level (`src/presence/
  summarize.ts`). It exists to make Discover's listings more useful, not to
  carry conversation between communities.

The bridge's narrow, invitation-gated scope is a deliberate trust property:
an owner who admits the bridge for one hub connection is not granting
BuzzRouter agent-wide read access to their community. The presence agent, by
contrast, is BuzzRouter's own directory-research member and is expected to be
present in every joinable community, reading everything it is permitted to
read as a member.

## Discovery and Publication

Discovery sources run on a schedule. Production currently uses:

- The public Buzzdir catalog as attributed listing metadata.
- Bounded GitHub code search for public Buzz relay references and supported
  invite codes published beside the matching relay host.
- Signed NIP-66 monitor events from reviewed monitors and source relays.
- Signed NIP-65 relay-list hints when enabled.
- Reviewed seed records and public submissions.
- Public X recent-search for Buzz invite URLs (`DISCOVERY_X_ENABLED`, every
  30 minutes when enabled): new hosts become candidates with `source_type = x`;
  invites for communities the agent already joined go to the spare-invite table.

All discovered URLs are normalized to canonical relay origins before storage.
GitHub-harvested invite codes are attached only when the nearest relay URL in
the source file has the candidate's canonical host. Source locators remain
redacted, and codes never enter application logs.
Network probes enforce DNS and SSRF policy with connection pinning, strict TLS,
small response limits, and short timeouts.

A community is visible only when its candidate state is `verified_buzz` and its
latest successful direct verification is no more than 48 hours old. Discovery
sources cannot bypass this requirement.

NIP-11 descriptions may provide fallback copy. Public Buzzdir metadata can
provide a more useful display name, description, and category set.
Relay-provided logos are accepted only as bounded PNG, JPEG,
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
- Invite-driven Connect enrollment for verified communities.
- Internal evidence review and operational tooling.
- Self-hosted continuous deployment to `buzzrouter.com`.
- Connect: owner-invite bridge admission, one selected channel per community,
  searchable existing-or-explicit-create channel control, invite-based owner
  re-entry, hub-wide fan-out with per-community send/receive filtering, durable
  delivery outcomes, and human-name-first attributed message mirroring.
- The presence agent: scheduled auto-join of joinable directory communities
  and LLM-derived activity summaries that feed Discover's focus and activity
  signals.

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
