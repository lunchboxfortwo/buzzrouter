# BuzzRouter admin console

**Status:** Agreed scope. Not yet implemented.
**Version:** 0.1
**Date:** 2026-08-01

The long-form analysis (protocol authority matrix, full compromise table,
per-action failure behaviour) is the first commit on this branch. It is worth
reading before implementing. This file is the decision.

## The situation

When someone creates a community through BuzzRouter, we generate their Nostr key
and keep an encrypted copy our server can decrypt. That is the fact everything
here follows from.

**Holding the key means we can act as that owner, in their community,
indistinguishably.** The relay sees a valid owner signature. It cannot tell
whether the owner, our application code, an employee with host access, or an
attacker who took the host produced it. No amount of UI scoping changes this,
because scoping does not appear in a signature.

## The decision

Three things, in this order.

**1. Tell them the truth.** The create screen says plainly that we keep a
decryptable copy and can administer the community on their behalf. Shipped
2026-08-01 (`src/hosted-signup/copy.ts`, guarded by `copy.test.ts`) after the
original copy claimed the opposite.

**2. Let them leave.** Export the key and go, at any time, without contacting
support. Export is permanent navigation, not an exceptional flow. It returns the
`nsec` with `Cache-Control: no-store`, and the console offers an offline check:
decode the key, derive the pubkey, and confirm the relay-signed kind-13534
roster still lists it as owner. Verify before deleting custody.

Deleting custody removes our ciphertext and revokes console sessions. Until
backups age out, say "deleted from active systems, recoverable from backup until
DATE" — never "gone."

**3. Let them run the place, starting with invites.** Minting an invite is what a
new owner needs first and the only owner action a keyless owner cannot otherwise
perform. BuzzRouter signs a NIP-98 request for `POST /api/invites`; the relay
returns the code.

Everything else — direct add by pubkey, remove, role change, icon, agent
onboarding — is **deferred**. Not cancelled: deferred, because Buzz's desktop app
already ships those (see below), so they buy us little and cost a lot.

## What Buzz already does (verified, so we do not duplicate it)

Checked against a clone of `block/buzz`:

- **Role changes are live** in the mounted settings UI
  (`CommunityMembersSettingsCard.tsx`, `changeRoleMutation`). An earlier reading
  that called these display-only was wrong.
- **Adding agents has a mounted UI** — `ChannelMembersBar.tsx:263` mounts
  `AddChannelBotDialog`. An earlier reading that said no such UI existed was
  wrong.
- **Direct add by pubkey is implemented but unreachable** —
  `CommunityMembersCard.tsx` imports `AddMemberDialog` but has zero importers.
- **There is no join-request approval queue.** An owner "accepts" someone by
  minting an invite. The only user-signed membership event is leave.

So our durable value is not "Buzz has no admin UI." It is remote web
administration for a community whose key we hold, plus a custody exit. When Buzz
ships an equivalent hosted surface, we should deep-link to theirs rather than
race them feature for feature.

## Custody

Reuse the existing pattern exactly — AES-256-GCM with a fresh nonce, auth tag,
and record-specific AAD, via `encryptConnectorPrivateKey` /
`decryptConnectorPrivateKey`. No second implementation of owner-key crypto.
Postgres stores ciphertext, nonce, tag, wrapping-key version, and public
identifiers. Never plaintext, in the database, logs, telemetry, errors, job
payloads, URLs, or fixtures.

One canonical custody record per community. The admin console extends the
hosted-create record; it does not copy ciphertext into a second table.

**Signer separation (agreed, not yet done).** Today
`deploy/self-host/compose.yml` mounts the wrapping-key file into both `web` and
`worker`, so a remote-code-execution bug in the internet-facing app yields every
managed owner key. Move the key out of `web` and behind a signer that exposes
named operations (`mint_invite`, `export_key`) rather than `sign_event`. This
must be true before we hold owner keys at scale — it does not need to block the
join and create flows reaching users.

**Backups.** Database ciphertext and wrapping keys live in separate systems and
separate administrative domains. Never bundle them into one backup. Losing the
wrapping key with no backup means the ciphertext is unrecoverable; there is no
"regenerate," because the community's identity *is* the key.

## Before we call this "managed custody"

Buzz's relay must be able to move a community to a **new** owner key. Today it
cannot: kind 9032 explicitly refuses to set `owner`, and the relay directs
operators to `RELAY_OWNER_PUBKEY` instead. Exporting the existing key is a
custody exit, not rotation.

The consequence is concrete: if an owner key leaks, it stays authoritative
forever. Until a tested rotation operation exists, the UI may offer same-key
export but must label new-key transfer "unavailable from this relay." That work
belongs to Block, not us.

## Audit

Every use of a held key writes an owner-readable trail: `requested` before
decryption, then `signed`, `submitted`, and one terminal outcome (`confirmed`,
`refused`, `outcome_unknown`, `local_failure`). Append-only; never rewritten.

It records the public event or NIP-98 auth id, the signer pubkey, the wrapping
key version, and which account or workflow asked. It never records private key
material, invite codes, raw session tokens, or wrapping keys.

When there is no matching signed phase, the log says "no matching BuzzRouter
signature found" — not "you did it." Someone else holding the same key may have
acted. A host attacker can sign outside this pipeline entirely, so this is
operational evidence, not cryptographic proof of our innocence.

## What we deliberately do not build

- No import of owner keys for communities people already run.
- No general signing endpoint, raw event composer, or "advanced" mode. That is
  an owner impersonation API.
- No chat client, and no posting as the owner. Agents sign their own messages.
- No agent runtime, persona catalog, or process management.
- No member approval queue — the relay has no such workflow.
- No NIP-11 or NIP-05 editor.
- No moderation tools. Bans, reports, and deletion are a different product with
  different failure costs.
- No "regenerate owner key" button.

## Open decision

**How much ceremony does the returning owner face?** The long-form version
required an external identity provider with passkey step-up before every
mutation. Set against one-page create, that risks meeting a new owner with an
identity provider and a passkey enrolment before they can invite one friend.

The likely answer is to tier it: a light account (Google OAuth or an email magic
link) for signing in and ordinary actions, with real step-up only on export,
custody deletion, and ownership transfer — the irreversible ones. Not yet
decided.

## The risk we are accepting

An authorized BuzzRouter host can act as every managed owner. Encryption at rest
does not prevent it, audit logs do not prevent it, and rate limits in the same
compromised process do not bind the key. Custody is opt-in, limited to
communities we generated, and the exit is always open — but if that risk is
unacceptable to an owner, the honest answer is that they should hold their own
key rather than use managed custody.
