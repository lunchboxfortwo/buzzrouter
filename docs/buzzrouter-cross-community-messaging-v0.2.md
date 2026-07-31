# BuzzRouter Cross-Community Messaging

**Status:** Engineering reviewed; ready for implementation
**Version:** 0.2
**Date:** 2026-07-30
**Supersedes:** Version 0.1 managed message router proposal

## 1. Decision

BuzzRouter should implement cross-community collaboration as paired shared
channels, similar to Slack Connect, rather than as individually addressed
messages sent to community handles.

An administrator discovers another community in BuzzRouter, proposes a shared
channel, and the destination administrator accepts it. BuzzRouter then pairs one
local Buzz channel in each community and mirrors messages and threads between
them through a distinct bridge identity on each relay.

```text
Community A                          Community B
#partner-research                    #partner-research
       |                                    |
       v                                    v
BuzzRouter bot A <-> durable bridge <-> BuzzRouter bot B
```

People write ordinary channel messages. They do not use
`@buzzrouter send`, learn a new addressing protocol, or leave Buzz to continue
the conversation.

BuzzRouter remains responsible for:

- Community discovery and verification.
- Shared-channel invitations and administrator approval.
- Relay and channel pairing.
- Bridge identities and credentials.
- Text and thread replication.
- Delivery state, retry, deduplication, and disconnect handling.
- A connection directory and audit history.

## 2. Research Findings

### 2.1 Community identity and aliases

Buzz does not currently use a global human-readable handle as the canonical
identity of a community.

The current product and architecture documents consistently define the
community by its URL or domain:

- In the single-community deployment, the relay URL selects the community.
- In multi-community deployments, the request host resolves to a
  server-controlled `community_id`.
- Hosted communities may use separate domains or subdomains.
- Unknown hosts fail closed rather than selecting a caller-provided community.

The merged multi-tenant implementation stores a unique normalized host on the
community record. It establishes domains as tenant-routing identifiers, not
display aliases for cross-community messaging.

Buzz also describes NIP-05 handles such as `alice@example.com`, but those belong
to humans and agents. The reviewed roadmap and open work do not define a global
`@community` alias registry or a `buzz:<community>` addressing scheme.

**Conclusion:** BuzzRouter should not create a competing protocol namespace.
It may retain a mutable directory slug such as
`buzzrouter.com/communities/researchhive` for discovery and display, but all
connections must bind to:

1. BuzzRouter's immutable community record ID.
2. The community's verified relay URL or domain.
3. The local Buzz channel UUID selected by that community.

Changing a BuzzRouter slug must not alter an existing shared-channel route.

### 2.2 Native shared-channel support

Buzz supports channels, threads, channel membership, bot identities, and signed
events within one community. It does not currently provide a native channel
that spans two communities.

The architecture is explicit:

- The relay is the source of truth for its community.
- There is no peer-to-peer event exchange, gossip, or relay replication.
- Channels, events, memberships, search, workflows, and audit records are
  scoped to one host-derived community.
- Multi-community hosting shares infrastructure while preserving logical
  isolation; it does not create cross-community channels.

Buzz Mesh is also community-local. It pools compute among members of one
community and explicitly prevents co-tenant communities from discovering or
joining that mesh.

### 2.3 Relevant roadmap and active work

Buzz has an open proposal and implementation PR for a Slack Connect bridge:

- Explicit one-to-one Slack channel to Buzz channel mappings.
- Two-way live text messages.
- Thread preservation.
- Visible bridge attribution instead of user impersonation.
- Durable mappings for retry and loop prevention.
- Pause-on-unshare behavior.
- An operator-run bridge outside `buzz-relay`.
- No new Buzz event kind or relay-core change.

This is not native Buzz-to-Buzz sharing, and the PR is not merged. It is,
however, strong evidence that an external channel bridge using the existing
Buzz WebSocket and signed-event surface is compatible with the project's
current integration direction.

A separate proposal for a generic pluggable transport included remote bridges,
but it was closed with an explicit decision not to move forward with that
transport abstraction at this time. BuzzRouter should therefore use the
existing relay protocol directly rather than depend on a future transport
interface.

**Conclusion:** Buzz does not natively support shared channels and has not
committed to native Buzz-to-Buzz shared channels. It does have active,
concrete work around an external Slack Connect bridge. BuzzRouter can occupy
the missing Buzz-to-Buzz layer without duplicating an existing native feature.

## 3. Product Contract

> Discover a Buzz community, propose a shared channel, and collaborate from
> inside both communities.

The product has four surfaces:

1. **Discover:** Find a verified community in the BuzzRouter directory.
2. **Propose:** Select an existing local channel or create a new shared channel,
   then send an invitation.
3. **Approve:** The destination administrator reviews the source community and
   chooses its corresponding local channel.
4. **Collaborate:** Members on both sides use ordinary Buzz messages and
   threads; BuzzRouter mirrors them.

There is no global community addressing system in v0.2. BuzzRouter directory
slugs are navigation aids, not protocol identifiers.

## 4. User Experience

### Propose a shared channel

From a verified community page, an administrator selects **Share a channel**.
The form contains:

- Source community.
- Source channel or **Create new channel**.
- Proposed shared-channel name.
- Short purpose.
- Optional expiration date.

The invitation is sent to the destination community's BuzzRouter administrator
inbox.

### Accept an invitation

The destination administrator sees:

- Verified source community name, icon, and relay URL.
- Inviting administrator identity.
- Proposed purpose.
- Requested capabilities: text and threads only.
- Source channel name.

The administrator accepts, rejects, or blocks the source community. On
acceptance, the administrator chooses an existing channel or creates a new
one. Channel names do not need to match.

### Use the shared channel

Members send normal Buzz messages. Mirrored messages display:

```text
Ada - Research Hive
Can you review the benchmark methodology?
```

The local event is authored by that community's BuzzRouter bridge identity.
The source community and original signer are visible. BuzzRouter never
impersonates the remote user.

Threads remain threads. Replies to a mirrored root are mirrored beneath the
corresponding root on the other relay.

The channel header identifies the external community and links to the
BuzzRouter connection record.

### Disconnect

Either administrator may pause or disconnect the route. Disconnecting:

- Stops new replication immediately.
- Preserves the local history already delivered.
- Marks the channel as disconnected.
- Revokes the affected connector route.
- Does not delete either community's local messages.

## 5. Architecture

### Components

1. **Community registry**
   - Immutable BuzzRouter community ID.
   - Verified relay URL or domain.
   - Mutable directory slug, display name, description, and icon.

2. **Connection service**
   - Invitation, acceptance, rejection, pause, and disconnect state.
   - Source and destination channel mappings.
   - Administrator audit history.

3. **Relay connectors**
   - One distinct BuzzRouter key per connected community.
   - NIP-42 authentication to that community's relay.
   - Subscriptions limited to mapped shared channels.
   - Publishing only through configured routes.

4. **Bridge service**
   - Validates source signatures and trusts the verified relay's admission
     decision for community membership.
   - Converts source events into canonical bridge messages.
   - Creates visibly attributed destination events.
   - Maintains root and reply mappings.

5. **Durable delivery**
   - PostgreSQL stores routes, messages, mappings, and delivery state.
   - Existing `pg-boss` infrastructure runs delivery and retry jobs.
   - Deterministic destination events prevent duplicate posts.

6. **BuzzRouter web app**
   - Discovery, invitations, connection management, health, and audit.
   - It is not the primary conversation surface.

### Route model

```text
SharedChannel
  id
  proposed_by_community_id
  state: proposed | active | rejected | disconnected
  purpose
  created_by
  created_at

SharedChannelEndpoint
  shared_channel_id
  community_id
  connection_id
  relay_url_snapshot
  local_channel_id
  local_channel_name_snapshot
  bridge_pubkey
  state: pending | active | paused | disconnected
  accepted_by
  accepted_at

BridgeMessage
  id
  shared_channel_id
  source_endpoint_id
  source_event_id
  source_actor_pubkey
  source_signed_event
  source_parent_event_id
  body
  body_sha256
  created_at

BridgeDelivery
  bridge_message_id
  destination_endpoint_id
  destination_signed_event
  destination_event_id
  state
  attempts
  next_attempt_at

BridgeEventMapping
  shared_channel_id
  endpoint_id
  bridge_message_id
  local_event_id
  local_parent_event_id
```

### Message flow

1. A connector observes a new kind-9 message in a mapped channel.
2. It ignores its own signer, known bridge markers, and already mapped events.
3. BuzzRouter verifies the event signature, configured relay and channel,
   route state, age, size, and source-event uniqueness. The verified relay's
   admission decision is authoritative for membership at publication time.
4. It creates a canonical `BridgeMessage`.
5. A `pg-boss` job creates and persists the signed destination event.
6. The destination connector publishes the event.
7. Relay acknowledgement changes the delivery to `delivered_to_relay`.
8. The event mapping becomes available for thread replies.

The destination event contains only the destination `h` channel tag, local
thread tags, and BuzzRouter provenance tags. Remote mentions and arbitrary
remote tags are not copied.

### Automation behavior

The installer creates a dedicated channel with no workflows attached by
default. Administrators may deliberately attach local workflows after the
shared channel is active.

BuzzRouter does not invoke workflows, agents, commands, or mentions on behalf
of the remote community. Mirrored authors and remote mentions are rendered as
text. This follows the external bridge direction already proposed in the Buzz
repository and does not require a new relay event kind.

## 6. Scope

### Included

- Two-community shared channels.
- Administrator invitation and bilateral approval.
- Text messages and threads.
- Distinct bridge identity per connected community.
- Visible source community and signer attribution.
- Durable retry, parent-aware thread delivery, and deduplication.
- Pause, disconnect, and route audit history.
- Directory integration and verified community identity.

### Excluded

- Global `@community` or `buzz:` addressing.
- Public anonymous senders.
- Attachments, reactions, edits, deletes, huddles, or DMs.
- More than two communities in one shared channel.
- Remote workflow or agent invocation.
- Message impersonation.
- Relay-to-relay gossip or native protocol federation.
- Dependence on the closed generic transport proposal.

## 7. Why This Shape

Shared channels fit recurring cross-community work better than addressed
message requests:

- The destination is established once through bilateral approval.
- Members continue working in Buzz instead of a separate inbox.
- Ordinary channel and thread behavior replaces command syntax.
- The shared channel creates a durable working context rather than isolated
  requests.
- Disconnect semantics are understandable and reversible.
- BuzzRouter's directory becomes the place where communities discover and
  establish connections.
- The architecture follows Buzz's active Slack Connect bridge precedent while
  filling the unimplemented Buzz-to-Buzz case.

## 8. Sources

- Buzz README, community identity and current roadmap:
  <https://github.com/block/buzz/blob/main/README.md>
- Buzz architecture, tenant binding and lack of relay replication:
  <https://github.com/block/buzz/blob/main/ARCHITECTURE.md>
- Buzz vision, domains, community isolation, and NIP-05 identity:
  <https://github.com/block/buzz/blob/main/VISION.md>
- Buzz Mesh, explicitly scoped to one community:
  <https://github.com/block/buzz/blob/main/VISION_MESH.md>
- Merged multi-tenant implementation:
  <https://github.com/block/buzz/pull/1321>
- Slack Connect bridge proposal:
  <https://github.com/block/buzz/issues/2822>
- Open Slack Connect bridge implementation:
  <https://github.com/block/buzz/pull/2826>
- Closed generic transport proposal:
  <https://github.com/block/buzz/pull/2756>
- Slack Connect product behavior:
  <https://slack.com/help/articles/115004151203-Slack-Connect-guide--Work-with-external-organizations>

## 9. Engineering Decisions

The engineering review keeps the complete v0.2 product scope while consolidating
the implementation around the existing Next.js application, PostgreSQL
database, `pg-boss` worker, and Nostr tooling.

### 9.1 Administrator authentication

All shared-channel mutations require a fresh NIP-98 request signed by the
verified `communities.owner_pubkey`. Authorization is checked in the store
query as well as the route handler. There are no delegated administrators in
v0.2.

The reusable bounded-body, NIP-98 verification, and replay-protection code moves
from the claim domain into generic HTTP modules. Claims and shared channels use
the same implementation without sharing domain-specific error codes.

### 9.2 Connector credentials

Each connected community has one distinct bridge key. Its private key is stored
as AES-256-GCM ciphertext in PostgreSQL with a random nonce, authentication tag,
and wrapping-key version. The wrapping key is loaded from a root-owned file on
the production host and never stored in PostgreSQL, source control, CI logs, or
ordinary application logs.

Rotation creates and verifies a new bridge key before switching the active key.
Revoking the community connection closes its socket and schedules encrypted key
material for deletion after a short recovery window. Disconnecting one shared
channel removes only that route and never interrupts the community's other
routes.

### 9.3 One-shot installer

Connection setup begins with an owner-signed web action that creates a hashed,
single-use, short-lived token. The owner then runs:

```text
npx @buzzrouter/connect <one-time-token>
```

The installer uses relay administrator credentials only on the community's
machine. It adds the tenant-specific bot, completes a signed challenge through
a temporary setup channel, and verifies a connector round trip. Route-specific
channels are selected or created later through the invitation flow. The
connection becomes active only after both the installer receipt and the
round-trip check succeed.

The installer is built from this repository and published by a release-triggered
GitHub Actions workflow. Production must not advertise an installer version
until its package publication succeeds.

### 9.4 Atomic ingestion

Canonical message insertion, delivery insertion, and `pg-boss` enqueue occur in
one PostgreSQL transaction. The queue call receives the same transaction through
`SendOptions.db`. A failure rolls back all three writes.

The canonical message ID is the deterministic queue job ID. Database uniqueness
on the source event and `(destination_endpoint_id, bridge_message_id)` prevents
duplicate ingestion and projection.

### 9.5 Runtime model

The existing worker owns one connector supervisor:

```text
worker startup
    |
    +--> load active community connections
    |       |
    |       +--> one authenticated WebSocket per connection
    |
    +--> reconcile connection state every 30 seconds
    |
    +--> pg-boss delivery workers
```

The production deployment runs exactly one worker. The supervisor reconnects
with bounded exponential backoff, records health, and immediately closes paused,
revoked, or disconnected connectors. Multiple-worker advisory locks and
`LISTEN/NOTIFY` are intentionally deferred.

### 9.6 Delivery and thread behavior

There is no separate persisted thread sequence in v0.2. Every reply records its
canonical parent. If the parent's destination mapping does not yet exist, the
delivery job retries with a bound. Deterministic destination event IDs and
database uniqueness make retries idempotent.

The destination event ID and signed event are persisted before publication. If
a relay acknowledgement is ambiguous, the connector queries the relay by event
ID before retrying.

### 9.7 Pause and disconnect

Pause belongs to an endpoint, not the shared channel globally. A route is
effective only when both endpoints are active. Each community may pause and
resume only its own endpoint.

Disconnect is terminal and may be initiated by either owner. Every delivery
rechecks endpoint and route state immediately before publication. Disconnect
cancels queued and in-flight delivery for that route, removes its connector
subscriptions, preserves already delivered local history, and marks undelivered
messages `cancelled`. The community connection and its other routes remain
active.

```text
                           destination rejects
proposed ------------------------------------------> rejected
   |
   | destination accepts and both endpoints connect
   v
 active <---- endpoint owner resumes ----> paused
   |
   | either owner disconnects
   v
disconnected (terminal)
```

## 10. Consolidated Modules

The implementation has three shared-channel modules rather than one module per
concept:

| Module | Owns |
| --- | --- |
| `src/shared-channels/store.ts` | Invitations, endpoint state, owner authorization, encrypted connector records, canonical messages, mappings, audit events, and atomic queue insertion |
| `src/shared-channels/connector.ts` | Connection supervisor, NIP-42 sessions, reconciliation, health, reconnect, publish, and shutdown |
| `src/shared-channels/bridge.ts` | Event validation, loop prevention, canonical message construction, inert destination projection, parent resolution, and deterministic event IDs |

Small generic infrastructure stays outside the domain:

- `src/http/nostr-auth.ts` owns bounded JSON authentication and NIP-98 replay
  protection.
- `src/http/api-error.ts` owns stable API error codes and status mapping.
- `src/jobs/queues.ts` declares the bridge delivery queue beside existing
  queues.
- `src/worker.ts` starts the connector supervisor and delivery worker.
- Route handlers remain thin adapters under `app/api/shared-channels`.

Types live beside the module that owns their behavior. A generic
`shared-channels/types.ts` dumping ground is not part of the design.

## 11. Data Model

A new migration adds:

| Table | Purpose and constraints |
| --- | --- |
| `community_connections` | One current connector per verified community; encrypted private key fields, bridge pubkey, relay snapshot, state, health, wrapping-key version |
| `connection_install_tokens` | Hashed single-use token, community, expiry, attempt state, and activation receipt |
| `shared_channels` | Immutable ID, proposer community, purpose, invitation state, optional expiry, and terminal disconnect metadata |
| `shared_channel_endpoints` | Exactly two endpoints per shared channel; community, connection, local channel, endpoint state, accepting owner, and channel snapshots |
| `bridge_messages` | Canonical source event, actor, body, body hash, canonical parent, timestamps, and unique `(shared_channel_id, source_endpoint_id, source_event_id)` |
| `bridge_deliveries` | One destination delivery per message; deterministic event, state, attempts, retry time, and unique `(destination_endpoint_id, bridge_message_id)` |
| `bridge_event_mappings` | Canonical message to local relay event mapping; unique endpoint/local event and endpoint/message pairs |
| `shared_channel_audit_events` | Owner signer, action, target, previous state, next state, and non-secret metadata |

Required indexes cover:

- Active connections by connector state.
- Invitations by destination community and state.
- Endpoints by community and effective state.
- Due deliveries by state and `next_attempt_at`.
- Source-event and local-event deduplication.
- Parent mapping lookup by endpoint and canonical message.

Rules, audit records, and routes use immutable community IDs. Relay URLs,
channel names, and directory slugs are snapshots and never authorization keys.

## 12. API and Installation Surface

The behavioral API boundaries are:

```text
POST /api/community-connections/install-token
POST /api/community-connections/activate
GET  /api/community-connections/current
POST /api/shared-channels
GET  /api/shared-channels
GET  /api/shared-channels/{id}
POST /api/shared-channels/{id}/accept
POST /api/shared-channels/{id}/reject
POST /api/shared-channels/{id}/pause
POST /api/shared-channels/{id}/resume
POST /api/shared-channels/{id}/disconnect
```

Every browser mutation uses owner-only NIP-98 authentication and accepts an
idempotency key. Installer activation uses its single-use token and signed
round-trip receipt; it never accepts relay administrator credentials.

The source community must complete connector installation before submitting an
invitation. The destination may receive an invitation while disconnected and
completes installation as part of acceptance.

## 13. End-to-End Data Flow

```text
Buzz kind-9 event
    |
    v
connector.ts
  verify configured relay/channel and ignore bridge-authored events
    |
    v
bridge.ts
  verify signature -> sanitize tags -> resolve canonical parent
    |
    v
store.ts transaction
  insert message -> insert delivery -> enqueue deterministic pg-boss job
    |
    v
delivery worker
  recheck route/endpoints -> resolve parent mapping -> persist signed event
    |
    v
connector.ts publish
  relay OK -> store mapping and delivered_to_relay
  ambiguous -> query deterministic event ID before retry
```

Remote mentions, commands, and arbitrary tags are never copied. The projection
contains only the destination channel tag, local thread tags, and BuzzRouter
provenance. New shared channels have no workflows attached; administrators may
deliberately attach local workflows after activation.

## 14. Failure Modes

| Failure | Handling | Test | User-visible result |
| --- | --- | --- | --- |
| Replayed or wrong-owner NIP-98 request | Reject before mutation | Route integration test | Stable `401` or `403` response |
| Installer token replay or expiry | Consume atomically; reject reused token | PostgreSQL integration test | Connection remains incomplete with retry guidance |
| Worker crash during ingestion | Message, delivery, and queue job roll back together | PostgreSQL transaction test | Source remains eligible for re-ingestion |
| Duplicate relay event | Source-event unique constraint returns existing message | PostgreSQL integration test | No duplicate destination post |
| Relay disconnect or authentication failure | Reconnect with backoff and persist health | Fake-relay integration test | Admin health shows degraded or unauthorized |
| Ambiguous relay acknowledgement | Query deterministic event ID before retry | Fake-relay integration test | Pending status, never a duplicate |
| Parent mapping missing | Bounded retry without global queue blocking | Worker integration test | Reply remains pending until parent arrives or delivery fails |
| Pause or disconnect races with delivery | Recheck endpoint state immediately before publish and reconcile route subscriptions | PostgreSQL and worker integration test | Delivery is paused or cancelled without affecting other routes |
| Wrong or corrupted wrapping key | Fail closed and never open connector | Encryption unit and integration tests | Connection health reports credential failure |
| Destination relay rejects an event | Classify permanent versus transient failure | Fake-relay integration test | Admin sees failed delivery and reason class |

There are no identified failures that are both silent and uncovered.

## 15. Test Plan

The project remains on Vitest for unit, route, and integration tests. CI already
starts PostgreSQL 16 and applies migrations, so no additional database test
container is introduced. A fake local WebSocket relay covers NIP-42,
reconnection, ambiguous acknowledgements, rejection, and loop prevention.

```text
CODE PATHS                                      USER FLOWS
[+] generic NIP-98 HTTP auth                    [+] Connect community
    [★★★] valid, malformed, stale, replay           [★★★] token, activation, retry
[+] invitation/store state                     [+] Propose and accept
    [★★★] owner, wrong owner, duplicate             [★★★] accept, reject, stale form
[+] encrypted connector keys                   [+] Pause and resume
    [★★★] round trip, wrong key, rotation           [★★★] endpoint ownership enforced
[+] atomic message ingestion                   [+] Disconnect
    [★★★] commit, rollback, duplicate               [★★★] immediate cancellation
[+] connector supervisor                       [+] Shared thread
    [★★★] reconnect, revoke, reconcile              [★★★] root, reply, parent delay
[+] delivery worker
    [★★★] OK, ambiguous, reject, retry

Coverage target: every listed branch has a behavior, edge, and error assertion.
No LLM evaluation is required.
```

Add one focused Playwright workflow using deterministic test signers:

```text
Owner A proposes
  -> Owner B accepts
  -> route becomes active
  -> Owner A pauses
  -> Owner B cannot resume Owner A's endpoint
  -> Owner A resumes
  -> Owner B disconnects
  -> both views remain disconnected
```

This is the complete browser-test scope for v0.2. It runs in CI against the
existing PostgreSQL service. Relay delivery remains covered by the fake-relay
Vitest integration suite.

## 16. Performance and Retention

No performance blocker is expected for the single-host MVP after applying the
listed indexes and limits:

- One indexed reconciliation query runs every 30 seconds.
- Each active connection owns one WebSocket and bounded reconnect state.
- Delivery worker concurrency is configurable and defaults to 10.
- Text bodies are limited to 16 KiB.
- Queue queries operate on indexed state and retry timestamps.
- Connector queries load endpoints in batches rather than per route.

Delivered message bodies and preserved signed source events are removed seven
days after terminal delivery. Hashes, event IDs, mappings, and audit metadata
remain while the route is active so old threads can receive replies. They are
removed 90 days after disconnect unless an abuse or legal hold applies. Local
Buzz relays remain the conversation-history source of truth.

## 17. What Already Exists

| Existing capability | Reuse decision |
| --- | --- |
| Verified communities, immutable IDs, `owner_pubkey`, and claim state | Reuse as the identity and owner-authorization source |
| NIP-98 signature verification and replay table | Extract into generic HTTP modules; do not duplicate |
| Relay URL normalization and SSRF controls | Reuse for connector relay validation |
| `nostr-tools` signature and event primitives | Reuse; build a separate persistent connector because discovery queries are bounded |
| PostgreSQL pool and migration runner | Reuse for all shared-channel state |
| `pg-boss` worker, retries, and queue configuration | Reuse for durable delivery and atomic enqueue |
| Next.js API route and error-response patterns | Reuse with thin shared-channel route handlers |
| Self-hosted production worker and GitHub Actions deployment | Extend for connector runtime and installer publication |

## 18. Implementation Order

| Step | Modules touched | Depends on |
| --- | --- | --- |
| Foundation | migrations, generic HTTP auth, shared-channel store | - |
| Bridge runtime | shared-channel bridge and connector, jobs, worker | Foundation |
| Product surfaces | shared-channel API routes and web views | Foundation |
| Installer | connector package and release workflow | Foundation |
| Verification | tests, production health, documentation | Bridge runtime, product surfaces, installer |

Parallel lanes:

- Lane A: Foundation.
- Lane B: Bridge runtime after Foundation.
- Lane C: Product surfaces after Foundation.
- Lane D: Installer after Foundation.
- Lane E: Verification after B, C, and D merge.

Launch B, C, and D in parallel worktrees after Lane A lands. They own separate
module directories; integration changes to `src/worker.ts`, queue declarations,
and GitHub workflows should be merged by Lane E to avoid conflicts.

## 19. Implementation Tasks

Synthesized from the engineering review. Each task maps directly to an approved
decision.

- [x] **T1 (P2, human: ~1 day / CC: ~2-4h)** - HTTP auth - Extract generic NIP-98 request authentication and API errors.
  - Surfaced by: Code quality review - claim-specific authentication errors cannot be reused safely.
  - Files: `src/http/`, `src/claims/`, existing claim route tests.
  - Verify: `npm test -- src/claims src/http`.
- [x] **T2 (P1, human: ~3 days / CC: ~1 day)** - Persistence - Add the shared-channel schema and owner-authorized store.
  - Surfaced by: Architecture review - bilateral endpoint state, immediate disconnect, and immutable identity constraints.
  - Files: `migrations/`, `src/shared-channels/store.ts`.
  - Verify: migrations plus focused PostgreSQL integration tests.
- [x] **T3 (P1, human: ~2 days / CC: ~1 day)** - Credentials - Add encrypted connector-key storage, activation tokens, rotation, and revocation.
  - Surfaced by: Architecture review - managed connector key custody.
  - Files: `src/shared-channels/store.ts`, production secret configuration.
  - Verify: encryption, wrong-key, token replay, rotation, and deletion tests.
- [x] **T4 (P1, human: ~5 days / CC: ~2 days)** - Bridge runtime - Implement canonical projection, connector supervision, and durable delivery.
  - Surfaced by: Architecture review - persistent relay sessions, atomic enqueue, idempotency, and parent-aware retry.
  - Files: `src/shared-channels/bridge.ts`, `src/shared-channels/connector.ts`, `src/jobs/`, `src/worker.ts`.
  - Verify: fake-relay and PostgreSQL integration suites.
- [x] **T5 (P1, human: ~4 days / CC: ~2 days)** - Product surfaces - Add invitation, acceptance, health, pause, resume, disconnect, and audit APIs and views.
  - Surfaced by: Product contract and owner-only bilateral administration decisions.
  - Files: `app/api/shared-channels/`, shared-channel pages and components.
  - Verify: route and component integration tests plus browser canary.
- [x] **T6 (P1, human: ~3 days / CC: ~1 day)** - Installer - Build the one-shot connector CLI and release publication workflow.
  - Surfaced by: Architecture review - relay credentials must remain on the community host.
  - Files: connector package, `.github/workflows/`, installation documentation.
  - Verify: clean-host install, expired token, replay, partial setup, and successful round trip.
- [x] **T7 (P1, human: ~2 days / CC: ~1 day)** - Verification - Complete database, fake-relay, route, component, focused Playwright, and release checks.
  - Surfaced by: Test review - transaction and bilateral flows require real integration coverage.
  - Files: `src/shared-channels/*.test.ts`, shared-channel API tests, `e2e/shared-channel-admin.spec.ts`, Playwright configuration, CI workflow.
  - Verify: `npm run typecheck && npm test && npx playwright test && npm run build`.

## 20. NOT in Scope

- Global community aliases or a `buzz:` namespace: conflicts with Buzz's
  domain-based identity direction.
- Delegated administrators: owner-only NIP-98 matches the current registry.
- Membership mirroring: the verified Buzz relay remains authoritative.
- Multiple worker instances, advisory locks, and `LISTEN/NOTIFY`: unnecessary
  for the current single-host deployment.
- Strict persisted thread sequencing and operator skip controls: parent-aware
  retry is sufficient for v0.2.
- Cloud KMS or one secret file per community: encrypted PostgreSQL keys plus one
  host wrapping key fit the current deployment.
- Broad browser coverage beyond the single bilateral administration workflow:
  route, component, and fake-relay tests cover the remaining branches.
- Attachments, reactions, edits, deletes, DMs, huddles, public senders, groups
  larger than two communities, payments, and protocol federation: unchanged
  from the product exclusions.

No separate `TODOS.md` entries are proposed. Deferred items above have explicit
adoption conditions and should be reconsidered only when those conditions
exist.

## 21. Review Completion

- Step 0 scope challenge: complete v0.2 retained with consolidated modules.
- Architecture review: nine issues resolved.
- Code quality review: one issue resolved.
- Test review: coverage diagram produced; two gaps resolved through PostgreSQL,
  fake-relay, route, component, focused Playwright, and canary coverage.
- Performance review: one issue resolved through indexes, limits, batch loading,
  and bounded retention.
- Failure modes: ten evaluated; zero silent critical gaps.
- Outside voice: skipped.
- Parallelization: five lanes; three implementation lanes can run in parallel
  after the foundation lands.
- Unresolved decisions: none.

## CGSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
| --- | --- | --- | ---: | --- | --- |
| CEO Review | `$plan-ceo-review` | Scope and strategy | 0 | Not run | Product direction was already fixed in v0.2 |
| Codex Review | `Codex review` | Independent second opinion | 0 | Skipped | No outside voice requested |
| Eng Review | `$plan-eng-review` | Architecture and tests (required) | 1 | CLEAR | 13 issues resolved, 0 critical gaps |
| Design Review | `$plan-design-review` | UI and UX gaps | 0 | Not run | Existing product design remains the visual source |
| DX Review | `$plan-devex-review` | Developer experience gaps | 0 | Not run | Installer DX is specified for implementation |

- **UNRESOLVED:** 0
- **VERDICT:** ENG CLEARED - ready to implement.
