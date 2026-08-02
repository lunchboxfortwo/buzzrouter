# Note: hub broadcast (one link, many communities)

**Status:** Idea to evaluate. Not a plan. Not approved.
**Date:** 2026-08-01
**Origin:** Owner, during the shared-channels UX pass.

Deliberately short. If evaluating this makes it longer, that is a signal to drop
it, not to write more.

## The idea

The BuzzRouter bot is already a member of every linked community. Today, two
communities that want to talk must set up a **bilateral** shared channel: propose,
accept, pin a channel on each side, confirm. That is one handshake per pair.

Since the bot is already everywhere, a community could instead link **once** to
BuzzRouter and send a message that reaches other linked communities, with no
per-pair setup.

## Why it is appealing

Bilateral setup grows with pairs; hub setup grows with communities. With 20 linked
communities, "everyone can reach everyone" is 190 bilateral handshakes versus 20
links. The plumbing for the hub version already exists — the bot is in the room.

It also matches what the owner actually wants from the Link tab: link once, then
talk, without the ceremony.

## The catch: linking is not consent to receive

A community that linked to BuzzRouter agreed to talk to **us**. It did not agree
to receive traffic from every other community on the network. If we ship the
obvious version, a directory quietly becomes a broadcast network, and the first
person to abuse it makes every linked community regret linking.

So receiving must be **its own opt-in**, separate from linking, and off by
default. That single rule is the whole design. Everything else below is
mechanics.

## Smallest shape that could work

1. **Receive opt-in.** A community sets "accept broadcasts" — default **off**.
   Linking does not set it. Turning it off later stops delivery immediately.
2. **Send.** An owner posts in their own BuzzRouter-linked channel. The bot fans
   it out only to communities with receive-opt-in on.
3. **Attribution.** Every delivered message shows which community it came from,
   in the message itself. A recipient must never wonder where it came from.

That is the entire v0, and it is one-way. A reply in a recipient community is
just a local message; it goes nowhere unless we build reply routing, and we are
not building reply routing. That is not a feature to design, it is what happens
if we do nothing, and it is also the cheapest defence against a thread that
detonates across twenty communities.

If it works, people will ask for more; that is the moment to decide, not now.

## What would make this fail

- **Spam.** One bad actor reaches everyone at once. Receive-opt-in limits blast
  radius; rate limits per sending community limit frequency. Both are needed
  before anyone but us can send.
- **Fan-out failure is partial.** Delivery to twelve of twenty communities is the
  normal case, not the exception. The sender must see per-community outcome, and
  we must not claim "sent" when it means "queued".
- **Muting one sender.** In v0 the off switch IS the mute: it is all-or-nothing,
  and that is proportionate at this size. Resist turning this into a per-sender
  allowlist — that is bilateral shared channels again, wearing a hat.

## Explicitly NOT in this idea

- No new protocol, no new event kind, no new relay contract.
- No moderation console, no reporting flow, no reputation scoring.
- No threading across communities, no cross-community search, no directory of
  broadcasts.
- No replacement for bilateral shared channels. This sits beside them, and
  bilateral stays the default for two communities that genuinely pair up.
- No changes to how communities link or how the bot is admitted.

## Do not build this yet — the trigger

Checked in production on 2026-08-01: **one** active community connection and
**zero** shared-channel endpoints. No bilateral shared channel has ever been
established, not once.

So the cost this idea removes has never actually been paid. Building fan-out now
would optimise a bottleneck we have no evidence exists, for a network of one node
and zero edges. It also means "bilateral setup has too many steps" cannot be a
user complaint — no user has finished the flow — so it is our hypothesis, not
their feedback.

Revisit when **both** are true:

1. At least one bilateral shared channel is in real, repeated use; and
2. Someone asks to reach several communities at once without pairing with each.

Until then the useful work is making the first bilateral channel get used.

## Open questions

1. Is one-to-many actually the demand, or is the real complaint just that
   bilateral setup has too many steps? If the second, fixing the setup flow is
   cheaper and this note should be dropped.
2. Who is allowed to send — any member, or owners/admins only? Owner-only is the
   safe start.
3. Does this need to exist before we have enough linked communities for it to
   matter? With five linked communities, bilateral is fine.

Question 1 is the one that decides whether to build this at all.
