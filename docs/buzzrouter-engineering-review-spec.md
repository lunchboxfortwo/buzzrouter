# BuzzRouter Cross-Community Messaging

**Status:** Engineering decision draft  
**Version:** 0.1  
**Date:** 2026-07-30  
**Purpose:** Give an engineer enough specificity to challenge the product, verify it against Buzz, compare two architectures, and cut a credible MVP. This is not an implementation mandate.

> **Superseded:** Version 0.2 replaces this design with paired, Slack
> Connect-style shared channels. See
> [buzzrouter-cross-community-messaging-v0.2.md](./buzzrouter-cross-community-messaging-v0.2.md).

## 1. Decision in one page

BuzzRouter should let a person send a text request to an opted-in Buzz community using a stable human-readable handle, and receive a threaded reply without joining that community.

The proposed MVP is **Design A: a managed router with a distinct bot identity in every connected community**.

- BuzzRouter owns the registry, ingress API, policy engine, durable queue, delivery workers, and web inbox.
- Each connected community gets a unique BuzzRouter bot key. There is no global bot identity shared by all customers.
- A source bot converts an intentional local message into a canonical BuzzRouter message.
- The destination community's bot visibly republishes it into a dedicated external-message channel.
- Unknown senders go to Message Requests. Community-level allowlists and blocklists determine what is delivered.
- BuzzRouter's own Buzz community is an operator control room, not the canonical data plane.

The original design, retained below as **Design B**, is a protocol-native system in which every community runs a local gateway and gateways exchange Nostr messages directly. It offers better sovereignty and privacy, but imposes more installation, key-management, reliability, and protocol work before the user has sent one useful message.

The recommendation is not “centralize forever.” It is:

1. Prove that communities actually want cross-community threads with Design A.
2. Keep addresses, message IDs, envelopes, and policy semantics transport-independent.
3. Add Design B later for communities whose privacy or network topology justifies operating a local gateway.

## 2. Product contract

> **Add BuzzRouter and give your Buzz an external front door.**

The smallest end-to-end product has four surfaces:

1. **Connect:** an admin connects a Buzz with one button plus, at most, one CLI command.
2. **Address:** the community claims a handle such as `@researchhive`.
3. **Message Requests:** admins accept, reject, allow, or block incoming community messages.
4. **Thread:** accepted messages appear in a dedicated Buzz channel, where local replies return to the sender.

Addresses are deliberately not email addresses:

- Display address: `@researchhive`
- Machine address: `buzz:researchhive`
- Deep link: `buzz://researchhive`
- Public page: `https://buzzrouter.com/@researchhive`

The public page says **Message this Buzz** and displays a verified community badge. Email can become an adapter later, but it is not the addressing model.

### Primary success measure

The north-star event is an **accepted external thread that receives a substantive reply**. The stronger retention signal is a second thread or reply between the same pair of communities within 30 days.

Raw messages, registered handles, and bot installations are not sufficient success measures.

## 3. Goals and non-goals

### MVP goals

- Connect an eligible Buzz with one short installation flow.
- Assign a unique, mutable handle backed by an immutable community ID.
- Send text from one connected community to another.
- Let an unconnected person use a community's public contact page and receive a reply through a private thread link.
- Put unknown senders into Message Requests by default.
- Support community-level default policy, allowlist, and blocklist.
- Preserve the original signed Buzz event when one exists.
- Make the destination projection visibly bot-authored; never impersonate a remote user.
- Provide threaded replies, durable retry, deduplication, revocation, and a minimal audit trail.

### Explicit non-goals

- Payment, postage, escrow, refunds, or paid fulfillment.
- Attachments, rich text, group chats, read receipts, or presence.
- Email-shaped addressing or inbound email.
- Automatically invoking destination agents, workflows, mentions, or commands.
- A general Nostr client or a replacement Buzz relay.
- End-to-end encryption from the source community to the destination community.
- A ranking-heavy public directory. The MVP registry exists to resolve and verify addresses.
- Guaranteed human response, work completion, or economic settlement.

## 4. Actors and user stories

### Actors

- **Community admin:** connects a Buzz, claims its handle, sets policy, and revokes access.
- **Community member:** sends or replies from inside Buzz.
- **Receiving moderator:** reviews unknown inbound requests.
- **Public sender:** contacts a community without running Buzz.
- **BuzzRouter operator:** handles abuse, delivery failures, and community claims.

### Required user stories

**US-1 — Connect a community**

As an admin, I can connect my Buzz and receive a test message without learning Nostr key or relay terminology.

Acceptance:

- The happy path is one web action and no more than one copy-pasted command.
- The connection proves control of the target community.
- The installer creates or selects a dedicated external-message channel.
- The generated bot identity is unique to this community.
- Removing the bot or revoking the connection immediately prevents new delivery.

**US-2 — Send community to community**

As a member of Community A, I can intentionally send text to `@researchhive` and see its status.

Acceptance:

- The source community and source signer are authenticated.
- The handle resolves to an immutable destination community ID.
- A retry or duplicate source event cannot create duplicate destination posts.
- “Delivered” means accepted by the destination relay, not read by a human.

**US-3 — Review an unknown sender**

As a receiving moderator, I can inspect one safe text preview and accept, reject, or block the request before it enters my community channel.

Acceptance:

- Unknown messages do not trigger local workflows, agents, mentions, or notifications.
- Follow-up messages in an unaccepted thread are suppressed.
- Accepting may optionally add the source community to Always Allow.
- Rejecting may optionally add it to Always Block.

**US-4 — Set ingress policy**

As an admin, I can choose one default and maintain community allow/block lists.

Default modes:

- `requests` — unknown communities enter Message Requests. **Default.**
- `deliver` — unknown communities are delivered directly.
- `allowlist_only` — unknown communities are rejected.

Policy precedence:

1. Platform safety block or hard rate limit.
2. Destination community blocklist.
3. Destination community allowlist.
4. Destination community default.

Block wins over allow. Rate, size, and replay limits still apply to allowlisted communities.

**US-5 — Reply**

As a member of the receiving community, I can reply in the Buzz thread and the response returns to the originating thread.

Acceptance:

- Only explicit `@buzzrouter reply` commands beneath a mapped BuzzRouter projection are captured. Ordinary local replies remain local.
- Router-authored events are never re-ingested, preventing loops.
- The remote thread displays the real replying community and signer without implying that BuzzRouter owns that identity.

**US-6 — Contact from the public page**

As a person without a connected Buzz, I can send a request through `buzzrouter.com/@researchhive` and receive a private capability link for the resulting thread.

Acceptance:

- Anonymous/public traffic always enters Message Requests.
- Basic bot and rate-limit defenses are applied before storage.
- Possession of the capability link grants access only to that thread.
- Connecting a Buzz later may mirror the thread, but is not required to receive the first reply.

## 5. Design A — managed bots and router

### Topology

```text
Source Buzz relay
      ↕ unique source bot
BuzzRouter ingress → registry → policy → durable queue
                                      ↓
                              unique destination bot
                                      ↕
                           Destination Buzz relay

Public message page ────────────────→ ingress
Admin dashboard ───────────────────→ policy / requests
Private BuzzRouter community ← sanitized operational events only
```

BuzzRouter's private operator community may contain channels such as `#connections`, `#delivery-failures`, and `#abuse-review`. Customer message bodies must not use that community as their canonical queue or database.

### Logical components

1. **Registry**
   - Resolves a normalized handle to an immutable community ID.
   - Stores verification, connection, and public-page state.
   - Maintains handle history so a renamed handle cannot silently change allow/block identity.

2. **Connector manager**
   - Creates one bot key per community.
   - Stores private keys in a managed secrets/KMS boundary.
   - Tracks relay connectivity, channel mapping, key rotation, and revocation.

3. **Ingress service**
   - Accepts messages from authenticated connectors and the public web form.
   - Validates signatures, schema, size, timestamps, and idempotency.

4. **Policy and requests service**
   - Applies platform limits, destination blocklist, allowlist, then the default.
   - Stores unknown messages outside the destination Buzz until accepted.

5. **Queue and delivery workers**
   - Provide at-least-once processing.
   - Serialize delivery within a thread.
   - Retry transient failures and dead-letter terminal failures.

6. **Projection adapter**
   - Converts a canonical message into a local Buzz post authored by the destination's BuzzRouter bot.
   - Keeps remote names and mentions inert.
   - Stores the mapping between canonical message IDs and local Buzz event IDs.

7. **Web app**
   - Connect flow, handle claim, public profile, composer, Message Requests, thread view, policy, and audit log.

### Installation contract

Desired flow:

1. Admin clicks **Connect Buzz**.
2. BuzzRouter creates a one-time claim token and a tenant-specific bot public key.
3. Admin runs a command conceptually equivalent to:

   ```text
   npx @buzzrouter/connect <one-time-token>
   ```

4. The installer proves community control, creates or selects `#external`, adds the bot, verifies round-trip connectivity, and claims the handle.
5. A test request appears.

The command is a UX contract, not proof that current Buzz exposes every required administrative primitive. Engineering review must verify the exact install API and permissions. If this cannot be done without a multi-step key-and-relay ceremony, that is a product blocker rather than documentation debt.

Managed mode requires the community relay to be reachable by BuzzRouter. Private or local-only relays require Design B or a later outbound connector.

### Compose contract

The first version must not require a Buzz client modification. A dedicated source channel can use a deliberately explicit text form:

```text
@buzzrouter send @researchhive
Can you review this benchmark?
```

An outbound reply beneath a mapped thread uses:

```text
@buzzrouter reply
Here is what we found.
```

Requiring an explicit command prevents a local side conversation from leaking across the community boundary. A later Buzz app integration may replace these text commands with a composer, destination picker, and **Reply externally** action without changing the router API.

### Canonical message envelope

```json
{
  "schema_version": 1,
  "message_id": "brm_01J...",
  "thread_id": "brt_01J...",
  "reply_to_message_id": null,
  "source": {
    "kind": "buzz_community",
    "community_id": "bc_01J...",
    "handle_snapshot": "sourceguild",
    "actor_pubkey": "<nostr-pubkey>",
    "source_event_id": "<nostr-event-id>",
    "signed_event": {}
  },
  "destination": {
    "community_id": "bc_01K...",
    "handle_snapshot": "researchhive"
  },
  "content": {
    "type": "text/plain",
    "body": "Can you review this benchmark?"
  },
  "integrity": {
    "body_sha256": "<hex>"
  },
  "created_at": "2026-07-30T12:00:00Z",
  "expires_at": "2026-08-06T12:00:00Z"
}
```

For a public sender, `source.kind` is `public_web`, community fields are absent, and a scoped thread capability is created. The service must validate and preserve a source signed event byte-for-byte when one exists.

### Message lifecycle

1. A source bot observes an intentional outbound message in the configured channel.
2. It ignores its own signer, known projection markers, unrelated posts, and malformed commands.
3. Ingress verifies the source signature, community membership, event age, message size, and idempotency key.
4. Registry resolves the destination handle once and records the immutable ID plus handle snapshot.
5. Policy returns `deliver`, `request`, or `reject`.
6. A request remains in the web moderation inbox. It is not published to the destination relay.
7. An accepted message enters the durable queue.
8. The destination bot publishes a visibly relayed, text-only projection into `#external`.
9. A successful relay acknowledgement changes state to `delivered_to_relay`.
10. An explicit `@buzzrouter reply` beneath a mapped local thread creates a new canonical message in the reverse direction. Unmarked local replies stay local.

Suggested terminal and observable states:

```text
received → awaiting_review → queued → delivering → delivered_to_relay
         ↘ rejected
                              ↘ failed | expired
```

There is no `read` state in the MVP.

### Safe projection rules

- The local projection is signed by the destination community's BuzzRouter bot.
- It visibly names the source community and, when verified, the original signer.
- The raw remote body is rendered as inert text.
- Remote `@names` must not become local `p` tags or local mentions.
- Remote tags, commands, links, or metadata must not be copied into executable local semantics.
- Inbound requests must never directly invoke a workflow or agent.
- The installer must verify that the dedicated external channel has no applicable workflows.

The final point may be insufficient in current Buzz if workflows can observe all kind-9 events. If Buzz lacks a reliable “external projection cannot trigger workflows” rule, the pilot must either add that rule upstream or keep accepted messages in the web inbox. Engineering review must treat this as a possible launch blocker.

### Minimal API surface

The exact URL layout may change; the behavioral boundaries should not.

```text
POST /v1/messages                         create an authenticated message
GET  /v1/messages/{message_id}            retrieve delivery state
POST /v1/message-requests/{id}/accept     accept and optionally allow source
POST /v1/message-requests/{id}/reject     reject and optionally block source
POST /v1/threads/{thread_id}/messages     public-link or web reply
GET  /v1/communities/{id}/policy          read ingress policy
PUT  /v1/communities/{id}/policy          change ingress policy
POST /v1/connections/{id}/revoke          revoke connector and bot credentials
```

Connector calls require scoped service authentication. User/admin calls require a separate session. All mutations accept an idempotency key. Any webhook added later must be signed and replay-bounded.

### Minimal data model

| Entity | Required fields |
| --- | --- |
| `Community` | immutable ID, current handle, display name, verification state, public-page state |
| `HandleHistory` | normalized handle, community ID, valid-from, valid-to |
| `Connection` | community ID, connector type, relay URL, channel ID, bot pubkey, secret reference, state |
| `IngressPolicy` | community ID, default mode, limits, version |
| `CommunityRule` | destination ID, source ID, `allow` or `block`, actor, timestamp |
| `Thread` | immutable ID, source/destination IDs, state, public capability hash if applicable |
| `Message` | immutable ID, thread ID, source/destination, content, signed source event, integrity hash, state, timestamps |
| `Delivery` | message ID, connection ID, attempts, next attempt, remote event ID, terminal state |
| `LocalMapping` | community ID, canonical message/thread ID, local event/thread ID |
| `AuditEvent` | actor, action, target, policy version, timestamp, non-secret metadata |

Rules and thread relationships use immutable IDs, never handles.

### Reliability requirements

- At-least-once queue processing with destination deduplication on canonical message ID.
- Stable message and thread IDs generated before enqueue.
- Exponential retry with jitter, bounded expiry, and a dead-letter path.
- Per-thread ordering where practical; never hold the whole destination queue behind one bad thread.
- Unique constraint on `(destination_connection_id, message_id)`.
- Persist the deterministic destination event ID before publishing. If the relay response is ambiguous, query by event ID before retrying.
- A relay `OK` is only `delivered_to_relay`.
- Connector health must distinguish unreachable, unauthorized, revoked, and degraded.
- Removing or rotating one customer's bot cannot affect another customer.

Proposed MVP limits:

- UTF-8 plain text only.
- 16 KiB maximum body.
- No attachments or remote embeds.
- Unaccepted thread: one preview; follow-ups retained but hidden or rejected according to a documented limit.
- Encrypted-at-rest message content retained for delivery/support for no more than seven days after terminal state; thread and audit metadata may remain for 90 days. These defaults require privacy review.

### Trust and security statement

In managed mode, BuzzRouter can read, delay, censor, or drop routed content. It controls each local bot key and can therefore author bot projections. It cannot forge the preserved signature of the original Buzz member.

Required controls:

- A unique bot key per community, stored behind KMS/secrets management.
- Immediate revocation and documented key rotation.
- Least privilege and a dedicated external channel.
- Signature, timestamp, replay, membership, and idempotency validation.
- HTML escaping, inert mentions, URL handling, and strict text limits.
- Per-source, per-destination, and platform-wide rate limits.
- Safe relay URL validation to prevent server-side request forgery.
- An auditable platform abuse block that overrides community policy.
- No customer content in operational Buzz channels or application logs.

Current Buzz permission behavior may not support true channel-scoped bot capabilities. The review must determine the effective authority granted to the bot rather than assuming that a role name is a security boundary.

## 6. Design B — original protocol-native gateways

Design B makes BuzzRouter primarily an address registry and interoperability specification.

### Topology

```text
Source Buzz relay ↔ local source gateway
                         ↓
             Nostr direct message transport
                         ↓
Destination Buzz relay ↔ local destination gateway

BuzzRouter registry: handle → community ID, gateway pubkey, inbox relays
```

### Flow

1. Every participating community installs and operates a local gateway.
2. The gateway creates or imports a community messaging key and advertises its inbox relays.
3. BuzzRouter verifies control and maps `buzz:researchhive` to the immutable community record, gateway pubkey, and current relay hints.
4. The source gateway captures an intentional local outbound message.
5. It produces the same canonical BuzzRouter envelope.
6. It sends the envelope using a Nostr private-message construction, plausibly NIP-17 direct messages wrapped with NIP-59 gift wrap and delivered to the recipient's advertised inbox relays.
7. The destination gateway decrypts, applies the destination's policy locally, and projects accepted messages into its Buzz.
8. Replies and application-level acknowledgements travel through the same path.

### Benefits

- Message bodies need not pass through or be stored by BuzzRouter.
- Community keys and moderation policy can remain local.
- Private-network communities can make outbound connections without exposing their relay.
- The transport better matches the “sovereign communities” thesis.
- Direct-to-direct communities can keep operating if the BuzzRouter message service is unavailable, subject to registry caching and relay availability.

### Costs and unresolved work

- Every community must run, update, observe, and secure another process.
- Installation includes relay selection, key custody, inbox advertisement, and health diagnosis even if hidden behind a script.
- Nostr relay acceptance is not application delivery; ACK, retry, ordering, deduplication, expiry, and thread mapping remain application work.
- Spam controls in private-message relay patterns are not a complete community policy system.
- Payment challenges such as x402 fit HTTP ingress more naturally than asynchronous relay delivery.
- Hybrid managed/direct routing is operationally and semantically harder than either pure design.
- Version skew and incompatible local policy implementations become part of support.
- A compromised local gateway has powerful access to its community unless Buzz adds narrow capabilities.

Design B is not “serverless Design A.” It moves the queue, policy boundary, keys, observability, and failure recovery into independently operated gateways. That is a real second architecture.

## 7. Direct comparison

| Criterion | Design A: managed bots | Design B: local gateways |
| --- | --- | --- |
| First useful message | Fastest path | Slower; local operation required |
| Install promise | One web action + one command, if Buzz APIs permit | One command can hide complexity but cannot remove local runtime/key duties |
| Central trust | Router sees content and controls bot projections | Registry need not see direct message content |
| Sovereignty | Moderate | High |
| Private relays | Unsupported without an outbound connector | Natural fit |
| Reliability ownership | One operator can implement and observe it | Split across communities, relays, and versions |
| Policy consistency | Central, testable precedence | Local, sovereign, susceptible to version skew |
| Payments later | HTTP/x402 fits naturally at ingress | Requires a challenge or quote side channel |
| Blast radius | Central outage affects routing; per-tenant keys limit identity blast radius | Local outages are isolated; shared inbox relays can still fail |
| Engineering scope | Conventional service plus unusual Buzz adapters | Conventional local service plus Nostr federation and distributed operations |
| Time to validate demand | Lower | Higher |
| Long-term ideological fit | Weaker | Stronger |

### Recommendation

Ship Design A only if the following are true after inspecting current Buzz:

1. A bot can be installed with acceptable authority and revoked reliably.
2. External projections can be prevented from triggering workflows and agents.
3. A meaningful share of target community relays is reachable from a managed service.
4. Thread replies can be observed and mapped without modifying every client.
5. The install can honestly fit the promised ceremony.

If any of the first two fail, do not paper over the risk. Choose one of:

- deliver accepted requests only in the BuzzRouter web inbox;
- make a narrow upstream Buzz change for connector capabilities and workflow suppression; or
- move the connector local and reconsider Design B earlier.

### Compatibility boundary

Preserve these across both designs:

- immutable community IDs and human-readable handle resolution;
- canonical message/thread IDs and envelope versioning;
- visible non-impersonating projections;
- policy precedence and rule identities;
- application ACK semantics;
- idempotency and expiry behavior.

A community record may eventually advertise `managed_bot` or `nostr_direct`. Direct-to-direct delivery may bypass the managed content service. The code should not pretend that swapping one queue adapter is sufficient; only the public contract is shared.

## 8. Delivery plan

### Milestone 0 — two-community vertical slice

- Manually register two test communities.
- Provision one unique bot identity per community.
- Send text A → B, reply B → A.
- Preserve source signature and map both local threads.
- Prove deduplication and retry during a relay outage.
- No public pages and no self-service install.

### Milestone 1 — pilot product

- Self-service connection and handle claim.
- Message Requests with accept/reject.
- Community default, allowlist, and blocklist.
- Revocation, connector health, audit events, and basic abuse controls.
- Five to ten opt-in communities.

### Milestone 2 — one-sided adoption

- Public `Message this Buzz` pages.
- Private web thread links for unconnected senders.
- A public registry profile for each connected community.
- Optional invitation to connect the sender's own Buzz.

### Deferred extension — paid first contact

Add optional **postage**, not escrow or payment for results:

- A destination may require a small payment to open a new unknown thread.
- Existing accepted-thread replies remain free for a limited window.
- A future x402 implementation can challenge the HTTP ingress request and bind payment to the message body hash, destination, quote, expiry, and idempotency key.
- Funds should go directly to the destination wallet where possible; avoid custody in the first version.

## 9. Acceptance and failure tests

The MVP is not ready until these pass:

- A valid message is delivered and replied to across two independent Buzz communities.
- Resending the same source event 100 times creates one destination projection.
- A blocked community cannot open a new thread even if it was previously allowed.
- An allowlisted community bypasses Message Requests but not rate or size limits.
- An unknown community cannot produce a destination relay post before acceptance.
- Remote mentions and tags cannot notify or invoke local users, agents, or workflows.
- A forged source event, stale event, or source-community mismatch is rejected.
- A bot cannot cause a relay loop by observing its own projection.
- An ordinary unmarked reply remains local; only an explicit external reply crosses the boundary.
- Destination relay downtime queues and later delivers without duplicate projection.
- Revoking Community A's bot stops A and has no effect on Community B.
- Renaming a handle does not alter allow/block rules or reroute an in-flight message.
- A leaked public thread capability exposes only its own thread and can be revoked.
- Logs, operator channels, and error traces do not contain message bodies or private keys.

### Kill criteria for the proposed MVP shape

Pause or redesign if review finds:

- bot installation grants authority equivalent to an unconstrained administrator;
- workflow invocation cannot be reliably suppressed;
- the majority of likely communities use unreachable/private relays;
- the one-command install requires hidden long-lived admin credentials;
- reply capture depends on brittle content parsing rather than stable event relationships;
- abuse moderation requires reading every message manually at platform scale;
- central content handling creates a compliance burden disproportionate to early demand.

## 10. Questions the engineering review must answer

1. What exact Buzz APIs, roles, and event kinds would each connector use at current `main`?
2. Can an installer create/select a channel and invite/revoke a bot without retaining admin credentials?
3. What effective permissions does that bot receive?
4. Can a bot-authored kind-9 external projection trigger any workflow, and how is that prevented?
5. Can native replies be mapped using stable tags/event relationships rather than parsed text?
6. How does the connector authenticate over WebSocket and HTTP, refresh sessions, and recover after relay restart?
7. Which relay deployments are reachable from the public internet in practice?
8. What source event data can be preserved and verified without exposing unnecessary private content?
9. What state belongs in PostgreSQL, the queue, and the secret store?
10. Which assumptions force an upstream Buzz change versus a BuzzRouter-only implementation?
11. Is the public capability-link model safe enough, or should public senders authenticate with a Nostr signer?
12. Are the seven-day content and 90-day metadata retention defaults defensible?

## 11. Copy-paste Codex engineering-review prompt

```text
Review the attached BuzzRouter specification as a hostile senior distributed-systems and security engineer. Do not implement it yet.

The spec contains two serious alternatives:
A. a managed central router with one distinct bot identity per connected Buzz community;
B. protocol-native local gateways exchanging Nostr messages directly.

Your job is to brutalize both designs and recommend the smallest architecture that can safely validate product demand.

First inspect the current Buzz repository rather than trusting the spec's claims. Cite exact files, symbols, and line ranges for findings about relay authentication, roles/scopes, channel membership, kind-9 ingestion, thread relationships, workflow triggers, bot installation/revocation, and relevant SDK builders. If the repository version differs from the references at the end of the spec, name the commit you reviewed.

Return:
1. A five-sentence reconstruction of the product so we can detect misunderstandings.
2. A table of every material assumption, with Verified / False / Unknown and evidence.
3. The five strongest architectural objections to Design A.
4. The five strongest architectural objections to Design B.
5. Security and abuse threat models for each, including key compromise, impersonation, replay, spam, SSRF, workflow injection, cross-tenant leakage, and metadata leakage.
6. Failure analysis for relay downtime, duplicate delivery, version skew, queue loss, partial installation, handle rename, revocation, and reply loops.
7. A concrete verdict: A, B, a hybrid, or neither. Do not answer “it depends” without choosing.
8. The smallest vertical slice you would build in two weeks, with components deliberately omitted.
9. Required upstream Buzz changes, if any, separated from BuzzRouter-only work.
10. A sequence diagram and proposed data model for your recommended slice.
11. Ten executable acceptance tests and explicit kill criteria.
12. A rough complexity estimate by component, identifying the riskiest unknown rather than pretending precision.

Be adversarial about the claimed one-command install. Be especially skeptical that a role called “bot” provides least privilege, that a relay acknowledgement means a human-visible delivery, and that inert external text cannot wake local agents or workflows.

Do not optimize for ideological decentralization or conventional SaaS architecture. Optimize for the fastest honest test of whether communities repeatedly send and answer useful cross-community messages without creating an unacceptable security boundary.
```

## 12. Reference points for verification

- Buzz architecture: <https://github.com/block/buzz/blob/main/ARCHITECTURE.md>
- Buzz Slack bridge proposal: <https://github.com/block/buzz/issues/2822>
- Buzz guest/channel-scoped write discussion: <https://github.com/block/buzz/issues/2475>
- Nostr NIP-05 identifiers: <https://github.com/nostr-protocol/nips/blob/master/05.md>
- Nostr NIP-17 private direct messages: <https://github.com/nostr-protocol/nips/blob/master/17.md>
- Nostr NIP-59 gift wrap: <https://github.com/nostr-protocol/nips/blob/master/59.md>
- x402 overview: <https://docs.cdp.coinbase.com/x402/welcome>

Historical Buzz code references previously inspected at commit `d40a33290e75791aa7ecf3ce7a252b66c2e35966`:

- SDK kind-9 builder: <https://github.com/block/buzz/blob/d40a33290e75791aa7ecf3ce7a252b66c2e35966/crates/buzz-sdk/src/builders.rs#L211-L238>
- Relay signer check: <https://github.com/block/buzz/blob/d40a33290e75791aa7ecf3ce7a252b66c2e35966/crates/buzz-relay/src/handlers/ingest.rs#L1519-L1542>
- Relay channel gate: <https://github.com/block/buzz/blob/d40a33290e75791aa7ecf3ce7a252b66c2e35966/crates/buzz-relay/src/handlers/ingest.rs#L1755-L1845>
- Current auth behavior at that commit: <https://github.com/block/buzz/blob/d40a33290e75791aa7ecf3ce7a252b66c2e35966/crates/buzz-auth/src/lib.rs#L120-L142>
- Workflow trigger path at that commit: <https://github.com/block/buzz/blob/d40a33290e75791aa7ecf3ce7a252b66c2e35966/crates/buzz-relay/src/handlers/event.rs#L520-L535>
