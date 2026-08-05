# Product Hunt launch video plan — cross-community messaging demo

Status: **Approved concept, pending execution.** The two Buzz communities are not
set up yet; owner will prepare them, then we dry-run and record. Companion to
`docs/product-hunt-launch.md` (the launch brief). This supersedes the brief's
generic storyboard for the video specifically; the brief's **gallery stills**
plan still stands for everything else.

## Concept

The video shows the one thing no directory can: **two independent Buzz
communities actually talking to each other over BuzzRouter.** Everything more
routine — discovering a community, listing your own — is covered by the
**gallery stills**, not the video.

Split:
- **Video** → the cross-community message exchange (the "wow").
- **Stills** → discovery, joining, and listing/submitting a community.

## The demo flow (what gets screen-recorded)

1. On **buzzrouter.com Discover**, find and **join a community** (the maker's
   community, "Community A" — open/joinable so the join works on camera).
2. The join hands off to the **Buzz client**, landing the maker inside Community
   A's channel.
3. In A's **hub-connected channel**, the maker sends an **addressed** message to
   a user in a different community:
   `@trusty-squire/lunchbox could you review this?`
4. It **arrives once in the Trusty Squire community** with **source attribution**
   (maker's name + Community A).
5. **Lunchbox replies**, addressing back (`@<community-A>/<maker> …`).
6. The reply **arrives back** in Community A with attribution.
7. End card: *"Find a community, or connect yours at buzzrouter.com."*

Cast:
- **Maker** (John Lee) — member of **Community A**.
- **lunchbox** (the maker's friend) — member of **Trusty Squire** (Community B).

## Prerequisites (must be true BEFORE recording)

- **Both communities connected to the BuzzRouter hub** (owner "connect one
  channel" setup done off-camera for A and for Trusty Squire).
- **lunchbox is a member of Trusty Squire**, with a known kind-0 roster name.
- **Community A is open/joinable** so the on-camera join via Discover succeeds.
- **The bridged channel is one a freshly-joined member can post in** — newly
  admitted members land in `general`, so `general` (or whatever channel A has
  bridged) must be the one the maker posts the addressed message in.
- Addressing works **both directions** (symmetric) between A and Trusty Squire.

## Accuracy rules (or it's wrong on camera)

- **Address at the very start.** Routing only fires when the first token is
  `@community` or `@community/user`. A mid-sentence `@lunchbox`, a wrong slug, or
  an unknown handle **stays local or bounces**.
- **A bounce is visible** ("BuzzRouter:" notice). Verify the exact community slug
  and lunchbox's exact roster handle beforehand so nothing bounces on camera.
- **BuzzRouter is the connective tissue, not the chat app.** Discovery + join are
  on buzzrouter.com; the actual messaging happens **inside the Buzz client**. The
  narration must say BuzzRouter *connects* the communities — not "chat in
  BuzzRouter."
- **The video spans two surfaces:** buzzrouter.com (Discover/join) → the Buzz app
  (community + messaging). The editor stitches them.

## Practical gotchas

- **~20s routing latency each way.** send→arrive is ~20s; the reply another ~20s.
  On a ~60s cut that's ~40s of dead air — the raw recording is longer than the
  final; the editor **speed-ramps or cuts** the waits and the narration covers
  them. Do **not** expect a real-time snappy exchange.
- **Brief hygiene:** use clean demo communities so no invite value, key, private
  history, or unrelated member's message is ever in frame.

## Production

- Owner **screen-records** the real flow (truthful; matches the brief's
  "real screens" rule). A video editor then beautifies (motion, pacing,
  speed-ramping the latency waits).
- **Narration:** the voiceover script already in `docs/product-hunt-launch.md`.
- **Music:** cleanly licensed / royalty-free only.

## De-risk before recording (owner + agent)

Doing this demo cleanly also clears the brief's hard blocker ("two consecutive
addressed deliveries … arrives once at the named destination with visible
attribution"). Before the shoot:

1. Confirm A and Trusty Squire are both connected to the hub.
2. Confirm lunchbox's exact roster handle and A's/Trusty Squire's exact slugs.
3. Send a test `@trusty-squire/lunchbox …`, confirm it lands **once** with
   attribution, and that a reply routes back — so recording works first take.
4. Confirm the maker can post in A's bridged channel as a fresh member.
