# BuzzRouter Community Auto-Discovery

Status: Phase 1 and Phase 2 implemented; claim-based Phase 3 retired

Date: 2026-07-29

> **Current product note (2026-08-01):** Ownership claiming and directory
> listing editing were removed. Operators provide listing context at submission,
> while Connect admission and later session re-entry use an owner/admin invite.
> The discovery and probe design below remains authoritative; claim-specific
> sections have been updated accordingly.

## Executive recommendation

Build auto-discovery as a provenance-driven relay index, not as a web scraper
that guesses community names.

BuzzRouter should:

1. Collect candidate relay origins from public, attributable sources.
2. Strip URL paths from source locators, while retaining only validated invite
   codes published near a relay URL with the same canonical host.
3. Verify candidates using public NIP-11 metadata and a bounded WebSocket
   handshake.
4. Classify a relay as Buzz only when its public metadata strongly identifies
   the Block Buzz implementation.
5. Keep technically discovered communities in an internal index until there is
   evidence that public listing is appropriate.
6. Collect operator-supplied listing context during submission without letting
   it override independent technical evidence.
7. Rank communities using BuzzRouter engagement and ratings, not private relay
   content.

This gives BuzzRouter useful automatic coverage without probing private
channels, enumerating hosted tenants, or exposing expiring invite links as a
public dataset.

## What the research established

### Buzz identity and public surfaces

- A Buzz community is selected by its relay URL. In the current single-relay
  model, one URL identifies one community. See the
  [Buzz README](https://github.com/block/buzz#what-is-this-really).
- Block-hosted communities use addresses shaped like
  `<name>.communities.buzz.xyz`. The hosted account flow is authenticated and
  owner-scoped; the open-source operator API is also protected by NIP-98 and an
  operator allowlist. There is no public "list every community" endpoint.
- Block-hosted communities are invite-only. A relay URL alone does not grant
  membership. See
  [Buzz Support](https://block.github.io/buzz/support.html).
- Buzz exposes public HTTP endpoints at `/`, `/info`, `/health`, and
  `/.well-known/nostr.json`. `/info` is a NIP-11 relay information document.
  See
  [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md).
- Buzz NIP-11 currently publishes the generic name `Buzz Relay`, a generic
  description, the exact software URL `https://github.com/block/buzz`, version,
  supported NIPs, relay `self` pubkey, limitations, and an optional
  community-specific icon.
- The community icon is public because an administrator or owner can set it
  with Buzz command kind `9033`, after which Buzz mirrors it into NIP-11.
- NIP-11 is explicitly designed for public relay metadata and supports name,
  description, icon, software, version, capabilities, and limits. See
  [NIP-11](https://github.com/nostr-protocol/nips/blob/master/11.md).

### Existing discovery standards

- NIP-65 kind `10002` events let users publish the relay URLs they read from and
  write to. These are signed, useful candidate hints, but they do not say that
  a relay is a public Buzz community. See
  [NIP-65](https://github.com/nostr-protocol/nips/blob/master/65.md).
- NIP-66 kind `30166` events are specifically intended for relay discovery and
  liveness monitoring. They can include normalized relay URLs, NIP-11
  documents, latency, capabilities, and requirements. The standard warns
  clients not to trust one monitor. See
  [NIP-66](https://github.com/nostr-protocol/nips/blob/master/66.md).
- BigBrotr already implements the useful generic pattern: seed candidates,
  discover relay URLs from events and APIs, validate WebSocket connectivity,
  fetch NIP-11, and retain health snapshots. See
  [BigBrotr](https://bigbrotr.com/).
- NIP-29 describes relay-hosted groups, including relay-generated metadata and
  private or public read policy. Buzz uses NIP-29 for channels inside a
  community, not as a global Buzz community registry. See
  [NIP-29](https://github.com/nostr-protocol/nips/blob/master/29.md).

### Observed public-source coverage

On 2026-07-29, GitHub's search API returned:

- 107 public code results containing `communities.buzz.xyz` outside
  `block/buzz`.
- 19 issues or pull requests in `block/buzz` containing
  `communities.buzz.xyz`.

These counts are discovery-source coverage, not a count of distinct
communities. Results include documentation, test fixtures, duplicate references,
and URLs that may contain capability-bearing invite codes.

The production crawler stores only the canonical relay origin as the source
locator. It may attach a supported invite code to that candidate when the code
appears near a relay URL with the same canonical host; codes must never reach
logs, queues, or analytics.

## Product boundary

### The crawler may read

- Public pages and public repository content.
- NIP-65 and NIP-66 events from explicitly configured public relays.
- `GET /info` or content-negotiated `GET /` NIP-11 metadata.
- TLS, DNS, HTTP status, and a no-auth WebSocket open/challenge.
- Hosting-provider feeds when a provider explicitly supplies public/listable
  communities.

### The crawler must not read

- Channel, message, member, repository, agent, workflow, or activity events.
- Invite redemption endpoints.
- Authenticated relay queries.
- Builderlab account APIs or Buzz operator APIs without a formal partnership.
- Certificate-transparency subdomain enumeration or dictionary attacks against
  `communities.buzz.xyz`.
- Private, loopback, link-local, multicast, or cloud metadata addresses.

### Publishing rule

Technical discovery and public listing are separate states.

A validated relay may be published automatically when:

- It appears in at least two independent public sources; or
- A trusted hosting provider marks it public/listable.

An operator submission enters the same discovery and verification pipeline; it
does not bypass the evidence or probe requirements.

A source only counts while it is fresh: NIP-66 evidence for 7 days and GitHub
or provider evidence for 30 days. Automatic eligibility also requires the
latest direct probe to have completed strict Buzz verification within 48 hours.
A failed or stale latest probe removes eligibility even when an older
classification remains in technical history.

A relay found only through generic monitoring stays in the internal candidate
index. This avoids turning a private relay's existence into a promoted listing
solely because a monitor observed it.

## Proposed architecture

```text
Public source adapters
  GitHub search       NIP-66 monitors       NIP-65 events       Partner feeds
         \                 |                     |                   /
                         Candidate queue
                               |
                    Normalize and redact URL
                               |
                     SSRF and DNS safety gate
                               |
               NIP-11 fetch + WebSocket handshake
                               |
                      Buzz classifier + evidence
                               |
                 Internal candidate / public listing
                               |
                 Submit, enrich, rate, and rank
                               |
                         BuzzRouter search
```

### Recommended MVP stack

- Web and API: the existing Next.js application.
- Database: PostgreSQL.
- Queue: `pg-boss`, using the same PostgreSQL instance.
- Worker: a separate TypeScript process sharing validation and schema packages
  with the web app.
- Search: PostgreSQL full-text search plus `pg_trgm`.
- Authentication: Nostr signed challenge for users and raters.
- Scheduling: one process-safe `pg-boss` scheduler, not browser or serverless
  best-effort cron.
- Deployment: one web service and one continuously running worker. The current
  GitHub Pages site remains the prototype until this backend exists.

PostgreSQL-backed jobs avoid adding Redis during the MVP while still providing
retries, leases, deduplication, and observable failure states.

## Source adapters

| Source | Role | Trust | MVP behavior |
| --- | --- | --- | --- |
| NIP-66 monitor events | Broad relay discovery and health hints | Medium; require multiple monitors and direct probe | Ingest normalized `d` relay origins and monitor identity |
| GitHub code/issues | Find publicly referenced Buzz hosts | Medium; public provenance but noisy | Search allowlisted queries, redact paths, and retain only supported host-matched invite codes |
| NIP-65 relay lists | Find user-endorsed relay origins | Low to medium; signed but not Buzz-specific | Candidate hint only, never sufficient to publish |
| Hosting-provider feed | Obtain public/listable tenants directly | High when authenticated and contractually scoped | Publish after direct probe |
| Manual URL | Recovery path and owner workflow | High after verification | Keep, but do not depend on it for coverage |

### Initial source queries

- Exact hosted suffix references: `communities.buzz.xyz`.
- Configuration references: `BUZZ_RELAY_URL`, limited to public code.
- Exact software references: `https://github.com/block/buzz`.
- NIP-66 events whose embedded NIP-11 `software` matches Block Buzz.
- NIP-65 relay origins, followed by direct NIP-11 classification.

Do not use broad web crawling until the exact-source pipeline has measured
recall and false-positive rates.

## Candidate normalization and safety

Perform normalization before enqueueing a probe:

1. Parse with the platform URL parser.
2. Accept `https`, `wss`, `http`, or `ws` as input.
3. Convert public clearnet origins to canonical `wss://host[:port]`.
4. Lowercase the host and apply IDNA normalization.
5. Remove user info, path, query, and fragment.
6. Reject malformed ports and overlong hosts.
7. Drop the entire candidate if credentials are embedded.
8. Hash the raw extracted string for deduplication, then discard it.

Before every network connection:

- Resolve all A and AAAA answers.
- Reject private, loopback, link-local, carrier-grade NAT, multicast,
  documentation, and cloud metadata ranges.
- Pin the request to the validated result or revalidate after DNS changes.
- Disable redirects, or allow only same-origin HTTPS redirects after another
  safety check.
- Use a 3 second connect timeout, 5 second total timeout, 256 KB NIP-11 body
  limit, and 1 MB decompressed limit.
- Limit concurrency per registrable domain and globally.

Icons need special handling. Real Buzz NIP-11 documents may contain large
`data:` image URLs. Store a content hash and a generated bounded thumbnail, not
the raw base64 string in every probe snapshot.

## Buzz classifier

### Verified Buzz

Publish the technical identity when all are true:

- NIP-11 is valid JSON.
- `software`, after canonical URL normalization, equals
  `https://github.com/block/buzz`.
- The relay supports NIPs `29` and `42`.
- A WebSocket connection opens and behaves as a Nostr relay.

### Probable Buzz

Quarantine for review when:

- `name` is `Buzz Relay`; and
- NIPs `29` and `42` are present; and
- auth is required or writes are restricted; and
- the `software` field is missing or noncanonical.

Probable matches should not be publicly labeled as Buzz until another
independent signal exists.

### Not Buzz

Reject when:

- The software URL names another relay implementation.
- NIP-11 is generic and there is no Buzz-specific evidence.
- The candidate only shares a hosted suffix string in unrelated content.

Keep classifier reasons and field-level evidence so false positives are
auditable.

## Data model

### `community_candidates`

- `id`
- `canonical_relay_url` unique
- `host`
- `state`: `discovered`, `probing`, `verified_buzz`, `probable_buzz`,
  `rejected`, `suppressed`
- `first_seen_at`
- `last_seen_at`
- `next_probe_at`
- `classifier_version`
- `classifier_reason`

### `community_sources`

- `candidate_id`
- `source_type`
- `source_locator`
- `source_actor_pubkey` nullable
- `source_observed_at` from signed event time or crawler observation time
- `first_seen_at`
- `last_seen_at`
- `evidence_hash`

`source_locator` identifies the public page. It never stores an extracted
invite URL. Evidence rows use stable source identity: repository path for
GitHub and actor pubkey for Nostr, with `last_seen_at` updated on repeat
observations. Nostr freshness uses the signed event's `created_at` persisted as
`source_observed_at`, so replaying an old report cannot renew it. This bounds
evidence growth while retaining freshness.

### `probe_snapshots`

- `candidate_id`
- `probed_at`
- `http_status`
- `ws_open_ms`
- `tls_valid`
- `software`
- `software_version`
- `supported_nips`
- `relay_self_pubkey`
- `auth_required`
- `restricted_writes`
- `icon_hash`
- `result_code`

Retain detailed snapshots for 30 days, then roll them into daily uptime
aggregates.

### `communities`

- `candidate_id` unique
- `visibility`: `internal`, `public`, `suppressed`
- `owner_pubkey` nullable; used by hosted and signed administration paths, not
  as proof that directory metadata is owner-authored
- `display_name`
- `description`
- `categories`
- `public_join_mode`: `invite_required`, `request_invite`, `public_link`
- `public_join_url` nullable, owner-supplied only
- `listed_at`
- `updated_at`

### `ratings` and `community_metrics_daily`

Ratings store one current rating per Nostr pubkey per community plus its signed
envelope. Daily metrics store unique views, saves, outbound community opens,
rating counts, and probe uptime.

## Listing intake and Connect admission

Listing context comes from `app/submit/` and is stored as attributed submission
source data. It does not create an ownership record or unlock a listing editor,
and it cannot replace the independent discovery and probe evidence required for
publication.

Connect uses a separate authority path:

1. The owner pastes an owner/admin invite for a verified community.
2. The bridge redeems it against the candidate's on-record relay, activates the
   connector, and returns a scoped session. If the connector is already active,
   a fresh valid invite mints a replacement session without creating another
   connection.
3. The owner filters the relay's existing channels in one combobox and binds a
   selection, or explicitly creates an unmatched name.
4. New-channel creation is a journaled create, promote-owner, demote-bridge
   handoff; a retry resumes the same channel and success never leaves the bridge
   as channel owner.

The invite is admission to Connect, not permission to edit directory metadata.

## Ratings and ranking

Do not infer quality from private message or member counts. BuzzRouter should
rank only from signals it can name and defend.

### Rating score

Use a Bayesian weighted mean:

```text
quality = (v / (v + m)) * R + (m / (v + m)) * C
```

- `R`: community mean rating
- `v`: unique raters
- `C`: global mean rating
- `m`: confidence prior, initially 10

Require a Nostr signed challenge and allow one current rating per pubkey and
community. Apply IP/device velocity limits without presenting them as identity.

### Trending score

```text
trending =
  0.35 * decayed_unique_saves
  + 0.30 * decayed_unique_opens
  + 0.20 * decayed_new_ratings
  + 0.15 * uptime_confidence
```

Use a 7 day half-life. Cap per-identity contribution and require a minimum
number of unique identities before a community can enter the global trending
list.

### Top rated

Sort by Bayesian quality, then unique raters, then freshness. Do not sort by raw
average.

### Operational badge

Display uptime and last verified time separately from rating. A healthy relay
is not necessarily a good community, and a private community's activity cannot
be measured externally.

## Worker jobs and cadence

| Job | Cadence | Retry policy |
| --- | --- | --- |
| `source.github` | Every 6 hours | Exponential, honor rate limits |
| `source.nip66` | Continuous subscription plus hourly reconciliation | Resume by event cursor |
| `source.nip65` | Daily targeted scan | Bounded relay and event allowlist |
| `candidate.probe` | On discovery | 3 attempts over 24 hours |
| `community.reprobe` | Daily; hourly for top listings | Back off to weekly after 7 failures |
| `ranking.rollup` | Hourly | Idempotent by date/hour bucket |
| `snapshot.compact` | Daily | Idempotent retention job |

Every job payload should contain canonical IDs, never arbitrary URLs received
directly from a browser.

Each source reconciliation holds a source-specific PostgreSQL advisory lock.
Nostr runs succeed and advance their cursor only after every configured source
relay explicitly completes the query with EOSE; relay failure or timeout fails
the run without checkpointing partial results. Event counts, message bytes,
individual event bytes, and aggregate bytes are bounded. A saturated result
fails closed as incomplete rather than adding a general-purpose relay
pagination engine to the MVP.

## Moderation and abuse controls

- Global and per-domain crawl budgets.
- Cloudflare Access in front of the internal review console, with application
  Basic authentication retained as defense in depth.
- Public opt-out page plus authenticated suppression workflow.
- Immediate suppression for legal, safety, or privacy requests while ownership
  is reviewed.
- Source-level denylist for spam domains and poisoned monitor keys.
- No wildcard-domain crawling.
- No invite tokens in logs, screenshots, analytics, or cached source bodies;
  stored host-matched tokens remain bearer credentials governed by probe and
  freshness decay.
- Evidence from at least two independent monitors before monitoring data affects
  public uptime.
- Signed ratings, one per pubkey, with anomaly detection for new-key bursts.
- Versioned ranking formulas and an explanation page showing signal categories.
- Manual review queue for probable classifiers, ownership disputes, and sudden
  metadata changes.

## MVP delivery plan

### Phase 1: Safe technical index, days 1-4

- Add PostgreSQL, migrations, and `pg-boss`.
- Implement canonical URL normalization and SSRF tests first.
- Add candidate, source, and probe tables.
- Implement NIP-11 and WebSocket probes.
- Implement the strict Buzz classifier.
- Seed from a reviewed static list and public GitHub references.

Exit condition: at least 20 known candidates can be processed repeatedly with
zero invite paths in source locators or logs and zero network requests to
private address ranges.

### Phase 2: Automatic sources, days 5-7

- Add NIP-66 ingestion from at least two configured monitor sources.
- Add the GitHub source adapter with cursoring and rate-limit handling.
- Add NIP-65 as candidate-only enrichment.
- Build an internal candidate review screen with evidence and probe history.
- Add public listing eligibility rules.

Exit condition: new publicly referenced Buzz relays appear in the internal index
within 6 hours, with source provenance and classifier evidence.

### Phase 3: Public listings and invite-first Connect

- Publish database-backed community details from verified discovery data.
- Accept attributed listing context through submission intake.
- Admit the bridge with an owner/admin invite and activate it by relay round trip.
- Select an existing local channel or explicitly create one, then bind it to the
  open hub.

Exit condition: an owner arriving cold can connect a verified community, regain
settings later with a fresh invite, and bind a local channel without a browser
signer, ownership claim, or editable directory listing.

### Phase 4: Ratings and launch ranking, days 11-14

- Add signed ratings and edit history.
- Add Bayesian quality, trending, and operational scores.
- Add fraud caps and minimum sample thresholds.
- Replace prototype fixtures with database-backed discovery and ranking views.
- Publish ranking methodology and data freshness.

Exit condition: rankings are reproducible from stored aggregates, low-sample
communities cannot top the list on a single rating, and every displayed metric
has a freshness timestamp.

## Launch metrics

- Candidate discovery latency: p95 under 6 hours from public reference.
- Probe success: at least 95 percent of reachable candidates classified in one
  cycle.
- False-positive rate: under 1 percent among publicly listed relays.
- Secret handling: zero invite paths in source locators and zero invite codes in
  application logs; stored host-matched codes remain confined to the database.
- Freshness: 95 percent of public listings probed within the previous 24 hours.
- Coverage: at least 50 verified Buzz relays or 80 percent of a manually
  maintained benchmark set, whichever is smaller.
- Link conversion: owners can find a verified community and reach invite
  admission without a dead route or browser signer.
- Ranking integrity: no community reaches global trending without the minimum
  unique-identity threshold.

## Explicit non-goals for the MVP

- Scraping messages, channels, members, agents, repos, or workflows.
- Estimating private community activity.
- Crawling every possible hosted subdomain.
- Discovery jobs mirroring or redeeming invites; Connect redeems only an invite
  explicitly pasted by an owner/admin.
- Replacing Buzz's planned native naming or directory work.
- Building a general-purpose Nostr relay directory.
- Workflow routing between communities.

## Decisions to carry into implementation

- Automatic technical indexing is allowed; public listing needs public evidence
  and a current successful probe. Submission intake cannot bypass either.
- Exact Block Buzz `software` metadata is the primary classifier.
- Invite URLs are capabilities, never independent discovery evidence, and may
  be retained only as host-matched candidate credentials.
- Ratings measure BuzzRouter user opinion, not relay health.
- Relay health is a separate operational signal.
- PostgreSQL plus `pg-boss` is the MVP queue and scheduler.
- A separate worker process is required before replacing the static prototype.
