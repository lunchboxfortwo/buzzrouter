# Hub Routing: Architectural Analysis

**Status:** Analysis for an operator decision — not a commitment
**Date:** 2026-07-31
**Context:** BuzzRouter now operates its own Buzz relay at
`wss://relay.buzzrouter.com`. The question raised: should that relay become a
central interchange that carries cross-community message traffic, instead of —
or in addition to — the v0.2 model where BuzzRouter's bridge dials each
community's relay directly?

## 1. What the two topologies actually are

**v0.2 (shipped): hub-and-spoke at the *service* level.**
BuzzRouter's worker holds one authenticated WebSocket per connected community,
as a client of that community's relay. Messages flow:

```text
Community A relay  <-- bridge worker -->  Community B relay
                    (BuzzRouter dials out)
```

**Proposed: hub-and-spoke at the *relay* level.**
Communities connect to BuzzRouter's relay, which stores and forwards
cross-community events:

```text
Community A relay --> connector A --> relay.buzzrouter.com --> connector B --> Community B relay
                       (communities dial in)
```

The first observation is the most important one: **BuzzRouter is already the
hub.** Every cross-community message already transits BuzzRouter's
infrastructure, is validated by BuzzRouter's bridge, and is re-signed by a
BuzzRouter-held key. Hub routing does not change the trust model, the custody
model, or the "who can read what" model. It changes only the *connection
topology* — who dials whom — and adds a durable store in the middle.

## 2. What hub routing would genuinely buy

1. **Reachability inversion.** Today the bridge must be able to reach each
   community's relay from the outside. A community behind NAT, a firewall, or
   on a private network cannot participate. With a hub, the community's
   connector dials out, which almost always works. *Current relevance: low —
   every community in the directory is by definition a publicly reachable
   relay, because the directory verifies them by direct probe.*
2. **A queue that survives BuzzRouter worker restarts without PostgreSQL.**
   The hub relay would be a second durable buffer. *Current relevance: none —
   `bridge_messages`/`bridge_deliveries` in PostgreSQL already provide durable,
   idempotent delivery with retries.*
3. **An event-native audit surface.** Bridge traffic as signed Nostr events on
   a relay is inspectable with any Nostr client. *Nice, not necessary; the
   audit tables cover this.*
4. **A first-party home for meta-collaboration.** PR/issue discussion about
   BuzzRouter, support, and announcements. *This is real and valuable — and it
   does not require hub routing. It only requires the relay to exist and to be
   a normal community that forms shared channels via the existing bridge.*

## 3. What hub routing would cost

1. **A protocol-shaped promise we don't control.** Buzz has no relay-to-relay
   federation; events reach the hub only if something dials out from the
   community side. So hub routing still requires per-community connector
   software — it relocates the connector from our worker to their host, which
   is *more* operational surface for community admins, not less. The v0.2
   installer already runs on their host but only does setup; steady-state
   operation stays on our infrastructure where we can monitor and fix it.
2. **Identity friction with Buzz's own model.** Buzz binds community identity
   to the request host. A hub relay carrying many communities' traffic either
   multiplexes them inside one host-derived community (fighting the isolation
   model the Buzz architecture documents insist on) or needs one hostname per
   routed community (a wildcard-DNS re-implementation of multi-tenancy we'd
   have to operate).
3. **A single point of failure with global blast radius.** Today, one
   community connection failing degrades that community's routes only. A hub
   outage stops every route at once, and hub capacity has to scale with total
   network traffic rather than per-route.
4. **Reversal cost.** v0.2 explicitly superseded the v0.1 managed-router
   proposal after engineering review. Reversing that within days of shipping,
   without a new forcing constraint, burns the review's value and the
   just-published installer/connector work.

## 4. Recommendation

**Do not build hub transport now.** The one substantive advantage —
reachability for non-public communities — addresses a population that cannot
currently exist in the directory. Everything else the hub would provide is
already provided by PostgreSQL, the audit tables, or the relay's mere
existence.

**Do use `relay.buzzrouter.com` as BuzzRouter's first-party community:**

- Home channel for support, feedback, and release announcements.
- The natural place to discuss BuzzRouter PRs and issues on Buzz itself.
- Listed in the directory like any community, and the first to accept
  shared-channel invitations — dogfooding the exact product we ship.

**Adoption conditions that would reopen the hub question** (record them, then
stop thinking about it):

1. Communities that cannot expose a public relay ask to join the directory
   (NAT/firewalled deployments) — the reachability argument becomes real.
2. Buzz upstream ships or commits to relay-level federation or a transport
   interface — the protocol-shaped risk disappears and the bridge could
   speak it natively.
3. Route volume grows past what one worker's outbound-connection model
   handles — revisit topology alongside the deferred multi-worker work
   (advisory locks, LISTEN/NOTIFY) noted in the v0.2 design.

## 5. Relay deployment record (operational)

- Stack: `/home/lunchbox/buzz-router-relay-prod` (`buzz-router-prod` compose
  project: relay, Postgres 17, Redis, MinIO; fresh secrets in `.env`, mode
  0600).
- Public URL: `wss://relay.buzzrouter.com` — proxied CNAME to the existing
  `buzzrouter` Cloudflare tunnel, whose ingress gained a
  `relay.buzzrouter.com → http://buzz-router-relay:3000` rule (config
  version 3). The relay container joins the `buzzrouter_default` network
  under that alias, so cloudflared reaches it directly.
- The `buzz-prod` (trustysquire) stack is untouched: an interim Caddy site
  block used before tunnel access was available has been reverted, and
  `buzz.trustysquire.ai` verified healthy afterwards.
- Cloudflare API note: the vaulted `Cloudflare/Api token` field holds a
  **Global API Key**, which authenticates with `X-Auth-Email` +
  `X-Auth-Key` headers, not `Authorization: Bearer`. Sent as a bearer token
  it returns 9109 "Invalid access token". The `Access token` field is an
  OAuth token that can read zones/DNS but not tunnel configuration.
- Owner: `RELAY_OWNER_PUBKEY` matches the operator key used for
  `buzz.trustysquire.ai`. Membership requirement is off (open relay), matching
  the trustysquire configuration.
