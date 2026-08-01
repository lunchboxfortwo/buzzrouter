# BuzzRouter admin console

**Status:** Proposed design, not approved for implementation

**Version:** 0.1

**Date:** 2026-08-01

**Scope:** Owner-key custody and the smallest honest web administration surface

## 1. Decision

BuzzRouter should expose a narrow admin console only for communities whose owner
key BuzzRouter already generated and holds through the hosted-create flow. Version
0.1 should let that owner:

1. mint invite links;
2. add an already-known pubkey directly as a relay member;
3. remove a non-owner member and change a member between `member` and `admin`;
4. set or clear the community icon;
5. generate and admit a self-hosted agent identity to the relay and selected
   channels;
6. inspect every attempted use of the held owner key; and
7. export the real owner key and leave BuzzRouter custody without contacting
   support.

It should not pretend that the key has narrower authority than it does. **Holding
the key means we can impersonate the owner, in their community,
indistinguishably.** The relay sees a valid owner signature. It cannot tell whether
the owner, BuzzRouter application code, a malicious BuzzRouter employee with host
access, or an attacker controlling the BuzzRouter host caused it.

This proposal is opt-in custody for newly managed communities. It does not ask
owners of existing communities to import their owner keys. It is also blocked from
launch until two prerequisites are true:

- PR #57's create result tells the truth that BuzzRouter retains a decryptable,
  encrypted copy of the owner key and binds the community to an authenticated
  BuzzRouter account.
- The hosted relay operator provides a tested, owner-visible ownership-rotation
  operation. Current Buzz explicitly rejects setting `owner` through kind 9032 and
  directs operators to `RELAY_OWNER_PUBKEY`
  (`crates/buzz-relay/src/handlers/relay_admin.rs:421-443`). Exporting the existing
  key is a custody exit; it is not key rotation.

## 2. Re-verified baseline: what an owner can do without us

This section was re-verified against Block Buzz commit
`63496cc1d4c6f1b7c613801bdcc694169dcf391a` in `/tmp/block-buzz`. Several facts
have changed since the supplied baseline. The corrections matter because they
reduce the admin console's unique scope.

### 2.1 Joining a community

Invite links still work. `POST /api/invites/claim` is signed by the joining key,
not the owner key (`crates/buzz-relay/src/api/invites.rs:341-352`). When the relay
has a join policy, the claim requires a receipt bound to the invite code and
policy version (`crates/buzz-relay/src/api/invites.rs:375-383`). Buzz's client
performs the explicit two-step flow: accept the current policy, receive a receipt,
then include it in the claim (`desktop/src/shared/api/invites.ts:169-190` and
`desktop/src/shared/api/invites.ts:219-240`).

This is a joining-user action. The admin console must not accept terms, attest age,
or claim an invite with the owner key on somebody else's behalf.

### 2.2 Accepting members

There is still no mounted pending join-request queue for relay membership. The
shipping relay HTTP surface mints an invite with an owner/admin NIP-98 signature,
then lets the joining pubkey claim it
(`crates/buzz-relay/src/api/invites.rs:1-10`). Minting supports bounded lifetime
and use count (`crates/buzz-relay/src/api/invites.rs:48-86`). In that ordinary
flow, an owner “accepts” someone by authorizing an invite, not by approving a
request after it arrives.

The only user-signed relay-membership request kind defined by this Buzz revision
is kind 28936, leave. Add, remove, and role change are admin commands; kind 13534
is a relay-signed snapshot (`crates/buzz-core/src/kind.rs:374-391`). This is about
relay membership. NIP-29 channel membership has separate join/leave kinds and
must not be mistaken for a community-wide approval queue.

The protocol can also add a known pubkey directly. Kind 9030 is an owner/admin
command; kind 9031 removes a member; kind 9032 changes role and is owner-only
(`crates/buzz-relay/src/handlers/relay_admin.rs:6-13`). These commands mutate relay
state and are not retained as ordinary Nostr events
(`crates/buzz-relay/src/handlers/relay_admin.rs:1-4`).

### 2.3 Adding a member by npub

The direct-add implementation still exists but is unreachable in the shipping
desktop application. `CommunityMembersCard` imports and mounts `AddMemberDialog`
(`desktop/src/features/community-members/ui/CommunityMembersCard.tsx:23` and
`desktop/src/features/community-members/ui/CommunityMembersCard.tsx:270-274`),
but this verification command returned no importers:

```text
rg --glob '!CommunityMembersCard.tsx' 'CommunityMembersCard' desktop/src
```

The mounted settings route imports `CommunityMembersSettingsCard` instead
(`desktop/src/features/settings/ui/SettingsPanels.tsx:31` and
`desktop/src/features/settings/ui/SettingsPanels.tsx:830-833`). It exposes invite,
remove, and, now, live promote/demote actions
(`desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx:188-234`
and `desktop/src/features/community-members/ui/CommunityMembersSettingsCard.tsx:299-312`).

**Correction to the supplied baseline:** role changes are no longer display-only.
They are reachable in the mounted app. Direct add by pubkey remains unreachable.

### 2.4 Adding an agent

**Correction to the supplied baseline:** Buzz now has a mounted “Add agents” UI.
`ChannelMembersBar` mounts `AddChannelBotDialog`
(`desktop/src/features/channels/ui/ChannelMembersBar.tsx:259-275`). The dialog can
select personas or teams and create local managed agents
(`desktop/src/features/channels/ui/AddChannelBotDialog.tsx:55-72` and
`desktop/src/features/channels/ui/AddChannelBotDialog.tsx:137-167`).

The standalone bot path also still exists. The current example expects
`BUZZ_BOT_PRIVATE_KEY`, not `BUZZ_PRIVATE_KEY`, and optionally
`BUZZ_OWNER_PRIVATE_KEY` for owner-attested authentication
(`examples/countdown-bot/README.md:23-39` and
`examples/countdown-bot/README.md:41-68`).

### 2.5 Strategic consequence

An admin console is still largely not duplicating Buzz's relay-membership UI:
direct add by pubkey is implemented but unreachable, and there is no relay-member
approval inbox. It does overlap Buzz on invite creation, member removal, role
changes, community icon, and agent creation. The overlap is real and must be
acknowledged.

BuzzRouter's durable value is therefore not “Buzz has no admin UI.” It is remote
web administration for a managed hosted community, custody exit, cross-community
workflows, and one audit trail across actions taken by BuzzRouter. When Buzz ships
an equivalent hosted admin surface, BuzzRouter should remove duplicate controls
from its primary navigation and deep-link to Buzz. The underlying action adapter
may remain only while it supports BuzzRouter-native workflows. We should not race
Buzz feature for feature.

## 3. Protocol authority matrix

An owner signature is a request, not a database write. Every mutating action still
requires a relay that implements the kind or HTTP contract, authenticates the
connection or request, recognizes the signer as owner, validates the command, and
persists the result.

| Surface | Who signs | What BuzzRouter can do with the held owner key | Relay or operator dependency | v0.1 |
| --- | --- | --- | --- | --- |
| NIP-42 AUTH, kind 22242 | Owner or agent | Answer a relay challenge for a WebSocket session. Current connector waits for a late challenge before treating a relay as auth-free (`src/shared-channels/connector.ts:602-653`). | Relay chooses whether to challenge and which scopes to grant. | Required transport step, not a user action. |
| NIP-98 HTTP auth, kind 27235 | Owner | Sign URL, method, nonce, and body hash (`src/http/nip98-client.ts:13-45`). | HTTP endpoint must exist and must accept that owner. | Required for invite minting. |
| Invite mint, `POST /api/invites` | Owner | Request an expiring, optionally use-limited invite. | Relay creates and returns the opaque code after role checks (`crates/buzz-relay/src/api/invites.rs:263-338`). | Expose. |
| Invite claim | Joining key | Nothing with the owner key. The claimant signs and, when required, supplies its policy receipt. | Relay verifies claim and policy. | Do not perform from owner console. |
| Kind 9030 | Owner | Add a known hex pubkey as `member` or `admin`. | Relay may refuse role, actor, ban, stale timestamp, or malformed tags. Re-adding an existing pubkey is a no-op and does not change role (`crates/buzz-relay/src/handlers/relay_admin.rs:311-359`). | Expose, with `member` default. |
| Kind 9031 | Owner | Remove a member or admin, but not self or another owner. | Relay enforces protected-owner and not-found cases (`crates/buzz-relay/src/handlers/relay_admin.rs:362-419`). | Expose. |
| Kind 9032 | Owner | Change an existing non-owner between `member` and `admin`. | Relay rejects self-change and any attempt to set `owner` (`crates/buzz-relay/src/handlers/relay_admin.rs:421-463`). | Expose only member/admin. |
| Kind 13534 | Relay only | Subscribe, verify the relay signature, and display the roster. BuzzRouter must never manufacture it. | Relay emits it after accepted membership changes; side-effect publication can fail after the DB mutation. | Read-back and reconciliation evidence. |
| Kind 9033 | Owner | Set or clear the community icon. | Relay validates the command and serves the result through NIP-11 (`desktop/src/shared/api/communityProfile.ts:1-12` and `desktop/src/shared/api/communityProfile.ts:35-50`). | Only configuration write in v0.1. |
| NIP-11 | Relay HTTP server | Read relay information. The owner key does not sign or directly edit the document. | Relay/operator owns the document. | Read-only diagnostics except the verified 9033-to-icon bridge. |
| NIP-05 | Domain HTTP server | Nothing merely by holding the owner key. NIP-05 requires control of `/.well-known/nostr.json` on a domain. | Domain/operator cooperation. | Display verification state only. |
| Kind 9007 | Owner or authorized channel creator | Create a channel; the signer becomes its channel owner. BuzzRouter already uses this kind in a journaled handoff (`src/shared-channels/channel-handoff.ts:21-30` and `src/shared-channels/channel-handoff.ts:157-199`). | Relay validates channel creation. | Use only when agent onboarding explicitly creates a dedicated channel. Not a general channel manager. |
| Kind 9000 | Channel owner/admin | Put an agent pubkey into a channel with a role. | Relay validates channel-local authority. Relay membership alone does not grant private-channel access. | Use for selected existing or newly created channels. |
| Kind 9 | Agent | The agent signs its own messages. The owner key must never sign chat as the agent. | Relay and channel must admit the agent. | Out of console; used later by the agent process. |

The key does not make arbitrary relay configuration expressible. Community name,
custom domains, join-policy text, NIP-05 mappings, billing, relay process settings,
and owner rotation need an explicit operator API or configuration change. Version
0.1 must show “managed by your relay provider” rather than a control that cannot
work.

## 4. Custody model

### 4.1 Boundary and storage

Reuse `encryptConnectorPrivateKey` and `decryptConnectorPrivateKey` exactly. They
use AES-256-GCM with a fresh 12-byte nonce, a 16-byte authentication tag, and
record-specific additional authenticated data (AAD)
(`src/shared-channels/store.ts:277-348`). For owner keys, the AAD is the owner
pubkey because it exists before a community ID does; the hosted-create code already
uses that convention (`src/hosted-signup/create-community.ts:26-60`).

```text
                         host trust boundary
  +-----------------------------------------------------------+
  | web/API process                                           |
  |   authenticated action -> policy check -> signer adapter  |
  |                                      |                    |
  |                     root-readable wrapping-key file       |
  |                     version -> 32-byte wrapping key       |
  |                                      |                    |
  |                 decrypt owner key only for one operation  |
  |                 zero plaintext buffer in finally          |
  +--------------------------+--------------------------------+
                             |
              ciphertext + nonce + tag + key version
                             |
                       +-----v------+
                       | PostgreSQL |
                       +------------+
                             |
                       encrypted DB backups
```

The wrapping-key provider loads a versioned key from
`BUZZROUTER_CONNECTOR_WRAPPING_KEYS_FILE`
(`src/shared-channels/connector.ts:496-524`). Self-host deployment mounts that
file read-only at `/run/secrets/connector-wrapping-keys.json`
(`deploy/self-host/compose.yml:29-35` and `deploy/self-host/compose.yml:59-68`).
The owner private key never appears in Postgres, logs, telemetry, error text, job
payloads, URLs, or repository files. PostgreSQL stores ciphertext, nonce, auth tag,
wrapping-key version, and public identifiers only.

No separate owner-key crypto implementation is allowed. PR #55 already follows
the desired pattern and zeroes the generated/decrypted buffer in `finally`
(`src/managed-identity/store.ts` on PR #55, lines 73-116 and 175-215).

### 4.2 Different compromise cases

| Compromise | What the attacker gets | What AES-GCM protects | What it does not protect | Required response |
| --- | --- | --- | --- | --- |
| Offline database dump | Encrypted owner and agent keys, public keys, account/community links, audit metadata, hashed sessions, and other application data. | The owner secret, if the wrapping-key file and its backups are not also obtained. | Availability, ciphertext deletion, metadata privacy, offline session-token guessing if tokens are weak, or later combination with a stolen wrapping key. | Revoke sessions as appropriate, investigate access, rotate DB credentials, preserve forensic copy. Key rotation is not automatically required unless the wrapping key was also exposed. |
| Live database credential compromise | Everything the credential can select or mutate. It may corrupt ciphertext, account bindings, or audit state. | Still prevents offline decryption without host key. | Application-level authorization if the attacker can alter account/community mappings. | Stop writes, revoke credential, restore/compare trusted backup, verify bindings and audit chain. |
| Application host compromise | Database credentials, wrapping-key file, and code execution in the process that is allowed to decrypt. | Nothing meaningful for keys reachable from that host. | Fleet-wide owner impersonation. The attacker can decrypt every record whose wrapping-key version is present and can bypass application rate limits and audit calls. | Treat every reachable owner key as compromised; revoke sessions; use relay-operator ownership rotation for every affected community; notify owners. |
| Database backup compromise | Same as an offline DB dump if the backup contains only database data. | Owner secret while wrapping keys remain separate. | Metadata privacy and future combination attacks. | Rotate backup access and DB credentials; assess whether wrapping-key backups were exposed. |
| DB backup plus wrapping-key backup | All owner keys covered by those versions. | Nothing. | Fleet-wide impersonation, including signatures created later and submitted elsewhere. | Same as host compromise. |
| Wrapping-key loss without a usable backup | Ciphertext remains, but cannot be decrypted. | Confidentiality. | Availability. AES-GCM has no recovery path. | Restore the separately protected wrapping-key backup. If none exists, use an owner-exported key or relay-operator ownership rotation. Never “regenerate.” |

Back up database ciphertext and wrapping keys in separate systems and separate
administrative domains. Test restoration of both, but never bundle them into one
ordinary application backup. Rotation must retain old key versions until every
record has been rewrapped and verified; deleting an old version early destroys
the keys it protects.

### 4.3 Read-only database role

The operator has stated that a `buzzrouter_readonly` database URL is held outside
the application. **UNVERIFIED:** this repository contains no definition or grants
for that role, so its current reach cannot be established from source.

The design invariant is non-negotiable: `buzzrouter_readonly` must have no
`USAGE` or table/column privilege on custody ciphertext, nonce, auth tag,
wrapping-key version, session hashes, reset credentials, contact email, or
sensitive audit metadata. Grant it only curated views containing public directory
data and explicitly owner-safe audit projections. A read-only role is not safe
merely because it cannot `UPDATE`; unrestricted `SELECT` over ciphertext and
session material is still a breach and makes later host-key compromise worse.

Before launch, CI or a deploy check must connect as `buzzrouter_readonly` and prove
that selects against every sensitive relation fail. This check belongs beside the
migrations that introduce the owner console, not in a manual runbook.

## 5. Authentication and authorization

Owner-key custody does not authenticate the human asking BuzzRouter to use the
key. PR #57 currently accepts a same-origin, rate-limited create request, then
returns the nsec; it does not create a durable authenticated owner account
(`app/api/create-community/route.ts` on PR #57, lines 25-79). An email address in
a row is not authentication.

Version 0.1 therefore requires an account session issued by an external identity
provider with email recovery and phishing-resistant step-up, preferably a
passkey. BuzzRouter stores only the provider subject, community binding, session
hash, timestamps, and revocation state. It does not store passwords or email OTPs.
The console cookie is `Secure`, `HttpOnly`, `SameSite=Lax`, host-only, rotated on
login and step-up, and backed by a hashed opaque session token. Account-to-community
authorization is checked on every request.

Required assurance levels:

- Normal recent session: view roster, configuration, agent state, and audit.
- Recent step-up: mint invite, add/remove member, change role, change icon, add
  agent, revoke another session.
- Recent phishing-resistant step-up plus explicit re-entry of the community host:
  export owner key, delete BuzzRouter custody, or initiate ownership rotation.

CSRF protection is same-origin plus an unpredictable synchronizer token on every
mutation. Origin checking alone is not the whole control. Each mutation also
requires an idempotency key scoped to account, community, action, and normalized
input.

This design does not reuse the signer-free `connection_owner_sessions` as a
general admin login. Those tokens are short-lived and community-scoped for one
connection flow (`src/shared-channels/owner-session.ts:30-89`); widening them
would turn an invite-derived convenience credential into permanent owner-key
authority.

## 6. Owner actions

### 6.1 Common action flow

```text
Owner UI
  |
  | session + CSRF + idempotency key + normalized intent
  v
Admin API
  |-- authenticate account and step-up
  |-- authorize account -> community
  |-- validate exact action allowlist
  |-- append audit: requested
  v
Signer adapter
  |-- load encrypted custody + wrapping-key version
  |-- decrypt into one short-lived buffer
  |-- sign exact NIP-98 request or Nostr event
  |-- zero buffer in finally
  |-- append audit: signed (event/auth id, never secret)
  v
Buzz relay
  |-- NIP-42 AUTH when WebSocket transport requires it
  |-- accept or refuse command / HTTP request
  v
Reconciliation
  |-- preserve exact signed public event
  |-- read back roster/NIP-11 when possible
  |-- append audit: confirmed | refused | outcome_unknown
  v
Owner UI: plain result, retry guidance, audit link
```

Never hold the decrypted owner key across requests, background queue wait time,
or a user interaction. A job contains an action ID and normalized public intent,
not private key bytes. The worker decrypts only when it is ready to sign.

Relay text is untrusted input. Bound it, strip control characters, retain a
sanitized diagnostic for operators, and map known prefixes to stable owner-facing
errors. Do not reflect arbitrary relay HTML or error bodies into the page.

### 6.2 Invite and member admission

#### Mint invite link

Input: expiry, maximum uses, and an owner-visible label stored only in BuzzRouter.
The default should be one use and the shortest product-acceptable lifetime, not
the relay's unlimited default. BuzzRouter signs a kind-27235 NIP-98 authorization
for `POST /api/invites`; the relay returns the code and URL.

Failure behavior:

- 401/403: “The relay no longer recognizes this key as an owner.” Mark custody
  health `unauthorized`; do not retry automatically.
- 400: show the normalized validation problem and preserve the owner's inputs.
- 429: show relay retry time when present; enforce a stricter BuzzRouter limit.
- timeout before response: mark `outcome_unknown`. The relay may have minted an
  invite whose code BuzzRouter never received. The upstream API has no
  idempotency contract or recovery-by-request-ID in the reviewed source, so an
  automatic retry can create a second live invite. Tell the owner that and require
  a deliberate retry.
- success: show the URL once in the result and keep only non-secret invite
  metadata if the relay offers no listing/revocation API. An invite code is a
  bearer admission credential and must not enter logs or telemetry.

There is no “Approve request” button because there is no pending relay-membership
request to approve.

#### Direct add by npub

Decode `npub` locally to 32-byte hex, show both forms, and require confirmation.
Sign kind 9030 with `p=<target>` and `role=member` by default. `admin` is available
only behind a stronger warning because it grants further membership-management
power.

Pre-read kind 13534. If the pubkey already exists:

- at the requested role, return an idempotent success without signing;
- at another role, offer the separate kind-9032 role-change action;
- as owner, refuse locally.

After relay `OK`, read back kind 13534. A matching relay-signed roster confirms
the state. If `OK` succeeds but the roster does not update, show “relay accepted;
roster confirmation unavailable,” not failure and not confirmed success.

#### Remove and role change

Remove signs kind 9031. Role change signs kind 9032 with only `member` or `admin`.
The UI must disable self-removal, owner removal, self-role change, and assignment
of owner before anything is signed. The relay remains authoritative and can still
refuse. A timeout republishes the exact same signed event bytes and event ID once;
it must not create a newly timestamped command until read-back decides whether the
first command landed.

### 6.3 Configuration

Version 0.1 exposes exactly one community-configuration write: set or clear the
icon through kind 9033. The client applies the same size, scheme, and image
validation as Buzz before upload. Success requires relay `OK`; a subsequent NIP-11
read confirms the served icon. If `OK` succeeds but NIP-11 remains stale, show
“accepted, waiting for relay metadata” and poll with a bounded deadline.

All other discovered fields are read-only diagnostics:

- NIP-11 relay name, description, software, supported NIPs, icon, and limits;
- NIP-05 status for owner and agent identities;
- canonical relay URL and NIP-42 health.

There is no generic “edit NIP-11 JSON,” “edit NIP-05,” or arbitrary event composer.
Those controls would imply authority the key does not provide and would create a
general-purpose signing oracle.

### 6.4 Add agents

BuzzRouter does not build an agent runtime in v0.1. Buzz already ships local
managed-agent creation. The console fills the narrower remote-hosting gap: create
a credential bundle for a self-hosted process and admit its independent pubkey.

The resumable sequence is:

1. Generate an agent keypair in the signer process. Encrypt and durably persist
   it before any relay mutation. The agent key has its own custody record and is
   never stored in plaintext.
2. Publish a kind 0 profile signed by the agent key. This is the agent's identity,
   not the owner's.
3. Sign kind 9030 with the owner key to add the agent pubkey as relay `member`.
4. For each selected channel, sign kind 9000 with the owner/channel-admin key to
   add the agent with channel role `bot` where supported.
5. Verify relay membership through kind 13534 and channel membership through
   relay read-back.
6. Offer a one-time self-host bundle containing the public relay/channel values
   and the agent secret. For the verified countdown example the key variable is
   `BUZZ_BOT_PRIVATE_KEY`; label the bundle as example-specific rather than
   inventing a universal `BUZZ_PRIVATE_KEY` contract.

Persist a journal with states `created`, `profile_published`, `relay_admitted`,
`channels_partially_admitted`, `ready`, `exported`, and `revoked`. A retry reuses
the same agent key and republishes the same step where possible. Never generate a
new key because step 3 or one channel failed.

The user sees per-step state. If three of five channel adds succeed, the console
names those channels, leaves two retryable, and does not claim “Agent added.” If
relay admission fails, the credential may still be exported, but the console says
the process cannot connect until admission succeeds.

Rate limits are per account, community, target pubkey, action, and IP. They limit
accidents and application abuse. They do not constrain an attacker who has the
owner key or root access to the signing host.

## 7. Threat model without euphemism

### 7.1 Assets and attackers

Assets are the owner private key, agent private keys, authenticated owner sessions,
wrapping keys, account-community bindings, invite codes, and the integrity of the
owner-visible audit trail.

Relevant attackers include:

- an unauthenticated internet user;
- a member or admin trying to obtain owner authority;
- an attacker with a stolen owner browser session;
- an attacker with a database dump or live DB credential;
- a malicious dependency or application exploit in the web/worker process;
- a BuzzRouter operator or attacker with host/root access;
- a compromised backup operator; and
- a malicious or buggy relay returning crafted refusals or inconsistent state.

### 7.2 What limits misuse

- account authentication, phishing-resistant step-up, CSRF protection, short
  step-up windows, and session revocation;
- a closed action allowlist with typed builders, never caller-supplied event JSON;
- per-community authorization before key access;
- privilege separation between the web process and a signer interface that accepts
  only named operations and bounded fields;
- rate limits and idempotency controls;
- decrypt-for-one-operation lifetime and buffer zeroing;
- append-only audit events and owner notifications for every mutation and export;
- separate DB and wrapping-key backup domains; and
- no owner-key import for existing communities in v0.1.

These controls reduce mistakes, web-session abuse, and some application
compromises. A signer process is still useful even on one host because it prevents
ordinary web code from requesting arbitrary signatures. Its API must be named
operations such as `mint_invite` and `add_member`, not `sign_event`.

### 7.3 What does not limit the cryptographic authority

- AES-GCM at rest does not help after the application host and wrapping key are
  compromised.
- A database audit log does not stop signing and can be bypassed or altered by a
  host attacker.
- Rate limits in the same compromised application do not bind the key.
- UI scoping does not appear in the signature. The relay sees the full owner.
- NIP-42 authenticates a key to a relay; it does not constrain what an owner may
  sign after authentication.
- NIP-98 binds one HTTP request, but anyone holding the owner key can create a new
  valid authorization for another request.
- Backups improve availability and increase the number of places whose combined
  compromise reveals every key.

If an owner does not trust BuzzRouter with indistinguishable owner authority, they
should not opt into custody. They should export and operate the key themselves, or
create/operate the community directly in Buzz. “Use it but trust us less” is not an
available cryptographic mode in this design.

## 8. Exit and ownership transfer

A custody product without a working door out is a trap. Export is a normal product
action, always visible in account security, never a support ticket.

### 8.1 Export format

Return a `Cache-Control: no-store` JSON response and a client-generated UTF-8 file:

```json
{
  "format": "buzzrouter-owner-key-v1",
  "community_id": "<public community id>",
  "relay_url": "wss://<host>",
  "pubkey_hex": "<64 lowercase hex characters>",
  "npub": "npub1...",
  "nsec": "nsec1...",
  "exported_at": "<ISO-8601 timestamp>"
}
```

The file contains a secret and is never uploaded back to telemetry, crash
reporting, or analytics. Export can be repeated after step-up; “one time” must not
be used as a substitute for a usable exit. Every export triggers an audit event and
out-of-band owner notification.

### 8.2 Verifying the export

The console provides an offline verification command or page that:

1. decodes the `nsec`;
2. derives the hex pubkey and `npub`;
3. compares both with the exported public fields; and
4. fetches the relay-signed kind-13534 roster and confirms that pubkey has role
   `owner`.

The owner must verify before deleting custody. A successful local derivation proves
the file contains the private key for the shown public key. The relay-signed roster
proves that public key is currently recognized as an owner. NIP-11 and NIP-05 do
not prove owner-key equivalence.

### 8.3 Two different exits

**Custody exit, same key:** after verification, the owner asks BuzzRouter to delete
its ciphertext. BuzzRouter revokes all console sessions and pending actions,
deletes owner-key ciphertext from the primary database, and schedules deletion
from backups according to a disclosed retention window. Until every backup expires,
the product must say “deleted from active systems; recoverable from backup until
DATE,” not “gone.” The relay owner pubkey does not change.

**Ownership rotation, new key:** generate or accept a new public key, prove the
request with both the current owner key and the authenticated account, ask the
relay operator to atomically replace the owner, read back kind 13534, then retire
the old ciphertext. This is not implementable with kinds 9030/9032 today. A tested
Builderlab/relay operation with stable idempotency, rollback, and read-back is a
launch requirement. Without it, the UI may offer same-key export but must label
new-key transfer “unavailable from this relay,” and the managed-custody product
has not met the full exit requirement.

Handing another person the same nsec is not ownership rotation. It creates two
indistinguishable owners and leaves the former holder able to act forever.

## 9. Recovery

### 9.1 BuzzRouter loses the key

“Regenerate” is not recovery. The community owner identity is the key. A new key
is a different identity and the current relay will not accept kind 9032 to promote
it to owner.

Recovery order:

1. Restore the exact ciphertext and exact wrapping-key version from separately
   protected backups.
2. If the owner previously exported the nsec, they continue outside BuzzRouter.
   A future re-import is deliberately out of v0.1.
3. If neither exists, use the relay-operator ownership-rotation procedure after
   strong human account recovery and manual fraud review.
4. If the relay operator offers no rotation and no exact key exists, the community
   is unrecoverable. Say so.

### 9.2 The user loses their account

Use the external identity provider's account recovery first. Rebinding a recovered
account to a community requires either:

- proof by signing a fresh challenge with the exported owner key; or
- a relay-operator recovery procedure with delayed notification to the old email,
  a cooling-off window, and fraud review.

Contact-email possession alone must not immediately reveal or use the owner key.
BuzzRouter support cannot override this with a database edit.

### 9.3 The user's session is stolen

The owner can list and revoke sessions from another authenticated device. High-risk
actions require recent step-up and send an out-of-band notification. A stolen
ordinary session should therefore expose read-only state, not signing authority.

If the attacker passed step-up and exported the nsec, session revocation is
insufficient. The key itself is compromised. Recovery requires new-key ownership
rotation at the relay, then deletion of old custody. This is another reason the
relay-operator rotation contract is a launch blocker rather than a future nice-to-have.

## 10. Audit and attribution

Every attempted use of a held owner key produces owner-readable audit events. The
audit pipeline writes `requested` before decryption, then appends `signed`,
`submitted`, and one terminal phase: `confirmed`, `refused`, `outcome_unknown`, or
`local_failure`. It never updates or deletes prior phases.

Each phase records:

- action ID, request ID, and idempotency key hash;
- community ID and relay URL snapshot;
- authenticated account ID, session ID, authentication assurance level, and
  origin (`owner_ui`, `buzzrouter_workflow`, or `operator_recovery`);
- normalized action type and non-secret target fields;
- exact public Nostr event JSON and event ID, or NIP-98 auth event ID and a hash of
  the HTTP method/URL/body;
- signer pubkey and wrapping-key version, never private material;
- bounded transport timing and normalized relay result;
- read-back evidence, such as roster event ID and observed role; and
- timestamp from BuzzRouter plus relay event timestamp where applicable.

Invite codes, nsecs, raw session tokens, wrapping keys, plaintext private keys,
request authorization headers, and arbitrary relay bodies are never audit fields.

The owner view answers “did BuzzRouter do this, or did I?” as follows:

- If BuzzRouter signed the exact event/auth ID, the log says which authenticated
  account/session or internal workflow requested it.
- If BuzzRouter has no matching signed phase, the log says “No matching BuzzRouter
  signature found,” not “you did it.” Another holder of the same key may have acted.
- A host compromise can sign outside this pipeline or falsify the database. The
  audit trail is operational evidence, not cryptographic proof that BuzzRouter did
  not act.

Owners can export their audit as JSON Lines. A daily hash-chain checkpoint should
be written to a storage system with separate credentials so later DB edits are
detectable. This improves tamper evidence; it still does not stop a host attacker
from impersonating the owner.

## 11. Conceptual data ownership

This is not a migration proposal. The implementation review should test this
minimum logical model against PRs #55 and #57 before choosing table names.

```text
AuthenticatedAccount
  1 --- * AccountSession (hashed bearer, assurance, expiry, revocation)
  1 --- * AccountCommunityRole (community, owner only in v0.1)

Community
  1 --- 1 HostedIdentityCustody
          (reuse PR #57 ciphertext, nonce, tag, pubkey, key version)
  1 --- * AgentCustody
          (independent agent key + resumable admission state)
  1 --- * OwnerKeyAction
          1 --- * OwnerKeyAuditEvent (append-only phases)
```

There must be one canonical owner-key custody record. Do not copy PR #57's
ciphertext into a second admin-console table. Account binding points at that
record. Deleting active custody removes that one record and prevents all later
signing.

Concurrency rules:

- serialize mutating owner actions per community;
- reserve the idempotency key and append `requested` in one transaction;
- never keep a DB transaction open while waiting on a relay;
- retry by action state and exact signed bytes;
- reconcile ambiguous outcomes before signing a new event; and
- make ownership rotation exclude every other action from start through read-back.

## 12. Relationship to in-flight work

### PR #55: managed Nostr identity

Reuse its custody pattern, do not fork it. PR #55 already:

- generates a key, seals it with the versioned host wrapping key, and stores only
  ciphertext/nonce/tag (`src/managed-identity/store.ts` on PR #55, lines 73-116);
- scopes plaintext use to a callback and zeroes the buffer in `finally`
  (`src/managed-identity/store.ts` on PR #55, lines 175-215);
- exports `nsec` plus `npub` and records first export
  (`src/managed-identity/store.ts` on PR #55, lines 232-263); and
- uses a no-store, rate-limited export endpoint
  (`app/api/identity/export/route.ts` on PR #55, lines 17-49).

The owner console should share these primitives and security tests. It should not
reuse a visitor managed identity as a community owner account, nor treat PR #55's
90-day browser cookie as sufficient assurance for owner administration.

PR #55's click-to-join path currently sends a bare invite claim and turns
`join_policy_required` into a refusal instead of performing the verified policy
handshake (`src/managed-identity/join.ts` on PR #55, lines 37-105). That does not
affect owner administration, but it must not be cited as evidence that managed
joining supports policy-gated communities.

### PR #57: one-page create

PR #57 is the source of owner keys for this console. It persists encrypted custody
before the irreversible bind (`src/hosted-signup/provision.ts` on PR #57, lines
71-85 and 146-175), and its provision store keeps only AES-GCM fields
(`src/hosted-signup/store.ts` on PR #57, lines 5-23 and 39-84). That is the canonical
custody record the console should extend.

PR #57 is wrong in one user-facing claim. Its API says “we do not keep a copy”
while returning the nsec (`app/api/create-community/route.ts` on PR #57, lines
77-93), but its own store retains decryptable ciphertext and the host retains the
wrapping key. The admin console depends on using that retained key. Change the copy
before either feature is presented as managed custody. The truthful statement is:
“BuzzRouter keeps an encrypted copy that its server can decrypt to administer your
community. Export lets you take control yourself.”

PR #57 also does not establish an authenticated BuzzRouter owner account. The
admin console must add that binding rather than infer ownership from `contact_email`.

Finally, PRs #55 and #57 both currently add a migration named
`20260801T1200_*.sql`. Their full filenames differ, so the filename-keyed runner can
apply both, but identical timestamp slots make landing order and human reasoning
needlessly ambiguous. Rebase and give the later migration a unique timestamp before
both land. Never rename one after production applies it.

## 13. What we deliberately do not build

- No import of existing community owner keys. It increases blast radius and asks
  established owners to surrender a key they already control.
- No general-purpose signing endpoint, raw event JSON form, or “advanced” event
  composer. That would be an owner impersonation API.
- No chat client and no kind-9 posting as the owner. Buzz is the conversation UI;
  agents sign their own messages.
- No agent runtime, LLM configuration, persona catalog, process logs, or local
  harness management. Buzz now has a mounted managed-agent UI.
- No pending member approval queue. The reviewed relay exposes invite claim and
  direct admin commands, not that workflow.
- No direct publication of kind 13534. It is relay-signed state.
- No NIP-11 or NIP-05 editor. Only the verified kind-9033 icon bridge is writable.
- No arbitrary channel management. Kind 9007/9000 are used only as a bounded part
  of agent onboarding or existing BuzzRouter shared-channel workflows.
- No moderation console in v0.1. Bans, timeouts, reports, message deletion, and
  retention are separate security products with different failure costs.
- No promise of immediate backup erasure. State the retention deadline precisely.
- No support-ticket-only export or ownership transfer.
- No “regenerate owner key” recovery button.

## 14. Self-attack and surviving risk

**Strongest objection:** this is a remote owner-signing service disguised as an
admin console. The same host that serves internet requests can access a fleet-wide
wrapping key and database credentials. A single host compromise can decrypt every
managed owner key, produce signatures the relay cannot distinguish from the owner,
and bypass the audit and rate limits that are supposed to constrain it. Why build
this instead of requiring user-held keys or a policy-enforcing external signer?

Attempted disproof:

1. AES-GCM defeats a database-only dump. It does not defeat host compromise.
2. Typed actions and a privilege-separated signer reduce ordinary web bugs. Root
   can read the wrapping file or alter the signer.
3. Audit and notifications improve detection. They do not prevent or
   cryptographically attribute misuse.
4. Rate limits reduce accidents and stolen-session damage. Root can bypass them.
5. Export gives the owner a door out. Until relay-backed owner rotation exists, a
   stolen copy of the old key remains authoritative.

The objection survives. This design was revised around it:

- custody is opt-in and limited to communities BuzzRouter generated;
- the consent screen states indistinguishable impersonation in plain language;
- export is permanent navigation, not an exceptional flow;
- existing owner keys are not imported;
- the signer accepts only named, typed operations;
- configuration and agent scope are narrow;
- host compromise is documented as fleet-wide key compromise; and
- managed custody does not launch until tested ownership rotation exists.

The surviving risk is still large: an authorized BuzzRouter host can act as every
managed owner. If that risk is unacceptable, the correct architecture is a
user-held key or an external signer whose policy is enforced outside the
BuzzRouter host. The current protocol and host wrapping-key file do not provide
that property.

## 15. Implementation-review questions

The immediate `/plan-eng-review` should try to reject this proposal unless it can
answer all of these with evidence:

1. What exact identity provider and step-up mechanism bind PR #57's create result
   to a returning human account?
2. What stable relay/operator API rotates `RELAY_OWNER_PUBKEY`, and how is it made
   atomic, idempotent, and observable?
3. Can the web process read the wrapping-key file directly, or is the named-operation
   signer genuinely privilege-separated?
4. Which relations and columns are denied to `buzzrouter_readonly`, and what
   automated check proves it?
5. How are ambiguous relay timeouts reconciled for HTTP invite minting versus
   deterministic Nostr event publication?
6. What prevents two sessions from racing a role change, custody deletion, or
   ownership rotation?
7. Where does the tamper-evident audit checkpoint live, and which credentials can
   modify it?
8. How long do database and wrapping-key backups retain a deleted owner key, and
   what does the UI promise during that interval?
9. Which exact actions require passkey step-up, and what happens on devices that
   cannot perform it?
10. How are all keys covered by an exposed wrapping-key version enumerated and
    rotated after host compromise?
