# BuzzRouter Community Auto-Discovery

Status: Proposed

Date: 2026-07-29

## Executive recommendation

Build auto-discovery as a provenance-driven relay index, not as a web scraper
that guesses community names.

BuzzRouter should:

1. Collect candidate relay origins from public, attributable sources.
2. Strip invite codes and all URL paths before persistence.
3. Verify candidates using public NIP-11 metadata and a bounded WebSocket
   handshake.
4. Classify a relay as Buzz only when its public metadata strongly identifies
   the Block Buzz implementation.
5. Keep technically discovered communities in an internal index until there is
   evidence that public listing is appropriate.
6. Let an administrator claim a listing to add its public name, description,
   categories, and join policy.
7. Rank communities using BuzzRouter engagement and ratings, not private relay
   content.

This gives BuzzRouter useful automatic coverage without probing private
channels, enumerating hosted tenants, or turning expiring invite links into a
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

The production crawler must extract only the relay origin and discard invite
paths and codes before data reaches logs, queues, analytics, or storage.

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
- A trusted hosting provider marks it public/listable; or
- An administrator claims it and opts into listing.

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
                 Claim, enrich, rate, and rank
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
| NIP-66 monitor events | Broad relay discovery and health hints | Medium; require multiple monitors or direct probe | Ingest normalized `d` relay origins and source signatures |
| GitHub code/issues | Find publicly referenced Buzz hosts | Medium; public provenance but noisy | Search allowlisted queries, redact paths immediately |
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
independent signal or administrator claim exists.

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
- `first_seen_at`
- `last_seen_at`
- `evidence_hash`

`source_locator` identifies the public page or signed event. It never stores an
extracted invite URL.

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
- `claim_state`: `unclaimed`, `admin_verified`, `provider_verified`
- `display_name`
- `description`
- `categories`
- `public_join_mode`: `invite_required`, `request_invite`, `public_link`
- `public_join_url` nullable, owner-supplied only
- `listed_at`
- `updated_at`

### `claims`, `ratings`, and `community_metrics_daily`

Claims store challenge state and verification method. Ratings store one current
rating per Nostr pubkey per community plus its signed envelope. Daily metrics
store unique views, saves, outbound community opens, rating counts, and probe
uptime.

## Administrator claim verification

### Custom-domain and self-hosted relays

Offer either:

- DNS TXT at `_buzzrouter.<community-host>`; or
- `https://<community-host>/.well-known/buzzrouter.json`.

Both contain a short-lived nonce and the claiming Nostr pubkey.

### Block-hosted subdomains

Owners cannot edit `communities.buzz.xyz` DNS. For the MVP, use the public icon
mirror as a control proof:

1. BuzzRouter issues a short-lived image URL containing a nonce.
2. The administrator temporarily sets it as the Buzz workspace icon.
3. BuzzRouter reads `/info` and verifies the nonce URL in `icon`.
4. The claim is marked administrator-verified.
5. The administrator restores the original icon.

This works because setting the workspace icon is restricted to Buzz admins or
owners and the result is intentionally public in NIP-11. It proves
administrator control, not legal ownership of the domain.

Long term, replace this with a provider-signed listing feed or an upstream
Buzz/NIP extension designed for directory claims.

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

## Moderation and abuse controls

- Global and per-domain crawl budgets.
- Public opt-out page plus authenticated suppression workflow.
- Immediate suppression for legal, safety, or privacy requests while ownership
  is reviewed.
- Source-level denylist for spam domains and poisoned monitor keys.
- No wildcard-domain crawling.
- No invite token storage, screenshots, or cached source bodies.
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
zero stored invite paths and zero network requests to private address ranges.

### Phase 2: Automatic sources, days 5-7

- Add NIP-66 ingestion from at least two configured monitor sources.
- Add the GitHub source adapter with cursoring and rate-limit handling.
- Add NIP-65 as candidate-only enrichment.
- Build an internal candidate review screen with evidence and probe history.
- Add public listing eligibility rules.

Exit condition: new publicly referenced Buzz relays appear in the internal index
within 6 hours, with source provenance and classifier evidence.

### Phase 3: Claim and public metadata, days 8-10

- Add Nostr authentication.
- Add DNS/HTTP claim methods.
- Add the hosted icon challenge.
- Add listing metadata, categories, join policy, opt-out, and dispute states.
- Publish community detail pages.

Exit condition: both a custom-domain relay and a hosted Buzz subdomain can be
claimed without BuzzRouter joining either community.

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
- Secret handling: zero invite paths or codes in database and application logs.
- Freshness: 95 percent of public listings probed within the previous 24 hours.
- Coverage: at least 50 verified Buzz relays or 80 percent of a manually
  maintained benchmark set, whichever is smaller.
- Claims: at least 30 percent of public listings administrator-verified in the
  first month.
- Ranking integrity: no community reaches global trending without the minimum
  unique-identity threshold.

## Explicit non-goals for the MVP

- Scraping messages, channels, members, agents, repos, or workflows.
- Estimating private community activity.
- Crawling every possible hosted subdomain.
- Mirroring or redeeming invites.
- Replacing Buzz's planned native naming or directory work.
- Building a general-purpose Nostr relay directory.
- Workflow routing between communities.

## Decisions to carry into implementation

- Automatic technical indexing is allowed; public listing needs public evidence
  or administrator/provider intent.
- Exact Block Buzz `software` metadata is the primary classifier.
- Invite URLs are capabilities and are never a discovery source of record.
- Ratings measure BuzzRouter user opinion, not relay health.
- Relay health is a separate operational signal.
- PostgreSQL plus `pg-boss` is the MVP queue and scheduler.
- A separate worker process is required before replacing the static prototype.
