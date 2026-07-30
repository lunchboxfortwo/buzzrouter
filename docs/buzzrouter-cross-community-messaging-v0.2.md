# BuzzRouter Cross-Community Messaging

**Status:** Product and architecture decision
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
   - Validates source signatures and current channel membership.
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
  owner_community_id
  state: proposed | active | paused | rejected | disconnected
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
3. BuzzRouter verifies the event signature, channel, route, member, age, size,
   and source-event uniqueness.
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
- Durable retry, ordering, and deduplication.
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
