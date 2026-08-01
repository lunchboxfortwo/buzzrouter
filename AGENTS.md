## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming -> invoke $office-hours
- Strategy/scope -> invoke $plan-ceo-review
- Architecture -> invoke $plan-eng-review
- Design system/plan review -> invoke $design-consultation or $plan-design-review
- Full review pipeline -> invoke $autoplan
- Bugs/errors -> invoke $investigate
- QA/testing site behavior -> invoke $qa or $qa-only
- Code review/diff check -> invoke $review
- Visual polish -> invoke $design-review
- Ship/deploy/PR -> invoke $ship or $land-and-deploy
- Save progress -> invoke $context-save
- Resume context -> invoke $context-restore

## Testing

- `npm test` (vitest) covers unit tests; DB-backed integration tests use
  `describe.skip` when `TEST_DATABASE_URL`/`DATABASE_URL` is unset, so they
  silently no-op without a database — see
  `src/shared-channels/store.integration.test.ts`. Set both on **separate
  lines** — `export A=x B="$A"` expands `$A` before assignment and skips the
  DB suite.
- `npm run db:migrate` applies `migrations/*.sql` against `DATABASE_URL`
  before running DB-backed tests or the app.
- `*.integration.test.ts` files share Postgres tables and reset their own
  fixtures each test. Vitest runs test files in parallel by default, so two
  such files executing at once can wipe rows out from under each other —
  `vitest.config.ts` puts every `*.integration.test.ts` file in its own
  `projects` entry with `fileParallelism: false` to serialize them relative
  to each other (the rest of the suite still runs in parallel). Prefer
  scoping a new integration test's cleanup to the rows it owns (e.g. `DELETE
  ... WHERE canonical_relay_url = $1`, see
  `app/api/submissions/route.integration.test.ts`) over `TRUNCATE`ing a
  shared table; if that's not practical, the file just needs to match the
  `*.integration.test.ts` glob to get the same serialization.
- There is no React component-testing library (no RTL/jsdom config) — client
  component behavior is covered by Playwright specs in `e2e/` instead
  (`npm run test:e2e`, needs `TEST_DATABASE_URL` and the app running per
  `playwright.config.ts`, which builds+starts it automatically).
- If TCP auth to the system Postgres isn't set up, connect over the local
  unix socket instead (peer auth matches your OS user to a same-named role):
  `postgresql://<os-user>@/<dbname>?host=/var/run/postgresql`.
- `e2e/shared-channel-unseeded-journey.spec.ts` drives the whole new-owner
  journey (claim → publish → connector activation → propose → accept) from a
  bare `verified_buzz` candidate, using an in-process fake `wss://` relay
  (`e2e/support/fake-relay.ts`) plus the committed cert/wrapping-key fixtures
  and connector env in `playwright.config.ts`. The only un-CI-able step, the
  claim-proof network hop (DNS/HTTPS/hosted-icon), is skipped explicitly and
  documented in that spec — do not add live-path proof bypasses to make it run.

## Migrations & the deploy verification gate

- The runner (`src/db/migrations.ts`) records applied migrations BY FILENAME
  (primary key `name`) and applies pending files in sorted order. So renumbering
  or renaming a migration that production already applied makes the runner treat
  the new name as pending and re-run its DDL — which fails on the next deploy
  unless the file is idempotent (`IF NOT EXISTS`/`IF EXISTS` throughout, so the
  reconciling re-run is a no-op that just records the new name). Prefer numbering
  uniquely on the way in; two concurrent same-number migrations already happened
  once (see `0013_presence_communities.sql` +
  `0015_shared_channel_confirmations.sql`, renumbered from 0013).
- Verify a renumber by running `npm run db:migrate` TWICE against a scratch DB
  seeded to production state (apply the committed tree first, then the working
  tree); the second run must print "Database schema is current."
- The deploy gate (`.github/workflows/deploy-production.yml` and
  `deploy/self-host/deploy.sh`) asserts that EVERY migration file in the
  deploying revision appears in `/api/health`'s `migrations[]` (the full applied
  set, from `src/db/readiness.ts`). Do NOT go back to comparing only the single
  newest name against `migration`: under concurrency production's newest applied
  migration legitimately runs ahead of the deploying revision's newest file, and
  a newest-to-newest compare reports that good deploy as a false failure.

## NIP-42 auth is a bounded wait, not an instant no-op

- Both `NostrRelayConnection.authenticate()` (`src/shared-channels/connector.ts`)
  and presence's `authenticate()` (`src/presence/reader.ts`) retry `relay.auth()`
  until the relay's AUTH challenge lands, giving up only after a settle deadline
  (~5s). A relay that never challenges is genuinely auth-free, but this path now
  costs the full deadline instead of returning instantly — the old code treated
  a "no challenge" throw as proof of that (racy: the challenge frequently arrives
  *after* the first `auth()` call, so it falsely no-op'd on relays that DO
  require auth and silently returned unauthenticated connections). The two
  copies aren't merged because `reader.ts`'s helper is module-private and the
  two modules' retry call sites (publish-retry, `listGroups` retry) differ.
  `e2e/support/fake-relay.ts` never sends a challenge on purpose (it tests the
  no-auth fallback), so any e2e assertion that waits on a connector's first
  relay read needs a timeout past that settle deadline.

## Shared-channel bot admission

- Owners admit the BuzzRouter bridge to their community three ways, in
  priority order: **invite link** (the bridge redeems it itself), **paste the
  bridge npub** in the Buzz app, then the **self-host npx command**. UI is
  `app/shared-channels/shared-channels-client.tsx` (`InstallerCommand`); server
  is `src/shared-channels/installer.ts`.
- The invite-claim contract lives on the **Buzz relay**, not this repo:
  `POST https://<relay-host>/api/invites/claim`, NIP-98 signed by the bridge
  key (the joining pubkey), body `{"code":"<code>"}`, exempt from the
  membership gate, pins role=member. Invite links are
  `https://<relay-host>/invite/<code>`. Verified empirically against a real
  relay — the relay source is a separate repo, so do not expect to find or
  re-derive this contract here. `resolveInviteClaimTarget` pins the claim URL
  to the community's on-record relay (SSRF guard).
- Activation is unchanged proof-of-admission: the bridge publishes a kind-0 and
  confirms the relay returns it (`verifyAndActivateCommunityConnection`).
- E2E that mints a token needs `BUZZROUTER_CONNECTOR_WRAPPING_KEYS_FILE` (set
  in `playwright.config.ts` → `e2e/fixtures/connector-wrapping-keys.json`).

## Shared-channel binding is chat-proof, not click-proof

- Accepting a shared channel is two steps. The web "Accept" only ARMS: it pins
  the chosen local channel onto the still-pending destination endpoint and mints
  a single-use code (`armSharedChannelConfirmation` in
  `src/shared-channels/store.ts`, `POST /api/shared-channels/[id]/accept`). It
  does NOT activate — a forwarded/leaked link or web click grants nothing.
- The bridge activates the route only when it hears that code typed as a kind-9
  in the chosen channel from a pubkey the community's relay-signed **kind-13534
  roster** marks owner/admin (`ConnectorSupervisor.handleConfirmationEvent`,
  then `confirmSharedChannelBinding`). It FAILS CLOSED if the roster can't be
  read. Roster format assumed: member tags `["p", <pubkey>, <role>]` (see
  `parseRoster`) — bespoke to Buzz relays, not re-derivable from this repo.
- So the bridge must subscribe to a pending endpoint's channel BEFORE the code
  is typed: `listActiveConnectorConfigs` returns `pendingConfirmations`, and
  `NostrRelayConnection.subscribe` adds them as a SECOND filter element (never a
  second key on one Filter — keys AND).
- The app server does NOT run the connector (that's `src/worker.ts`), so e2e for
  the confirmation runs a `ConnectorSupervisor` in the test process against the
  fake relay; the auth branches (owner ok / member / unreadable roster / replay
  / expired) are covered in `store.integration.test.ts`.

## Signer-free "Link" flow (mobile, no NIP-07)

- The `/shared-channels` page (`current="shared-channels"`, heading "Link", nav
  label "Link") leads with a signer-free flow so a phone with no browser
  extension can link. `SignerFreeLink` in `shared-channels-client.tsx`; the old
  browser-signer workspace (`OwnerTools`) is kept below as an optional power path
  (needed for outbound propose to an ARBITRARY community + full route
  management) — that path still requires NIP-98.
- `POST /api/community-connections/begin-from-invite` (UNSIGNED,
  `beginConnectionFromInvite`) identifies the community from the pasted invite
  LINK's relay host (`findVerifiedCommunityByRelayUrl`), reuses the existing
  signed-owner install path with the community's RECORDED owner pubkey, redeems +
  activates, then mints a short-lived, community-scoped **owner session**
  (`src/shared-channels/owner-session.ts`, `connection_owner_sessions`,
  migration `20260801T0900_connection_owner_sessions.sql`). The session rides in
  the `x-owner-session` header in place of
  a signature.
- `POST /api/shared-channels/connect-featured` (session-authed,
  `connectFeaturedCommunity`) is the one-press "Connect with the BuzzRouter
  community" CTA: **BuzzRouter is the source** proposing to the caller so the
  caller reuses the unchanged roster-gated ACCEPT path (arm→code→confirm). The
  source channel id is `buzzrouter:<callerCommunityId>` — scoped per caller
  precisely to dodge the `(community_id, local_channel_id)` unique index on active
  endpoints (BuzzRouter cannot reuse one shared source channel across partners).
- The session only substitutes for the owner signature; the roster-signed
  in-channel code is still the real bind authority (unchanged). E2e:
  `shared-channel-signer-free.spec.ts` (the fake relay now serves a stub
  `POST /api/invites/claim`); the connect-featured + code branch is in
  `store.integration.test.ts`.

## Channel-per-link: the bridge creates the channel

- Linking no longer needs a hand-made channel. The picker
  (`LocalChannelPicker`, both propose and accept) DEFAULTS to "create a new
  channel for this link"; the relay-backed picker is the "use one I already
  have" alternative. On submit the client calls
  `POST /api/shared-channels/create-channel` (NIP-98 signed) and links the
  channel it returns.
- `createDedicatedChannel` (`src/shared-channels/channel-handoff.ts`) publishes
  kind **9007** (create — the bridge becomes owner), then kind **9000** to
  promote the signing owner to `owner`, then 9000 to demote the bridge to
  `member`. The bot must never linger as owner of a channel in someone else's
  community. Kinds verified against Buzz's source — do not re-derive.
- The create→promote→demote sequence is 3 relay round trips, so it is journaled
  in `bridge_channel_handoffs`
  (migration `20260801T1100_bridge_channel_handoffs.sql`) and the call is RESUMABLE:
  invoked again with the same `idempotencyKey` it reuses the same channel and
  finishes the remaining steps. States: `creating → created → handed_off →
  completed`; `created` is the danger state (channel exists, bot still owns it).
  It throws a clear product error (`channel_create_failed` /
  `channel_handoff_incomplete`), never a raw failure, leaving the row retryable.
  The create-fail-promote-retry path is covered in
  `channel-handoff.integration.test.ts`.
- The `(community_id, local_channel_id)` unique index on active/paused endpoints
  is INTACT — a fresh channel per link is what keeps it satisfiable. Hand-picking
  an already-routed channel now fails as a product error
  (`channel_already_routed`, `assertChannelNotRouted`) instead of a raw 23505.
- The e2e fake relay MODELS these kinds now (`applyGroupManagement` in
  `e2e/support/fake-relay.ts`): 9007 makes a channel listable, 9000 writes a
  roster role, exposed via `relay.channels()` / `relay.roster()` for assertions
  (`shared-channel-create-channel.spec.ts`). Existing picker specs must click
  "Use a channel I already have" before touching the dropdown.

## Create-community front door

- `app/create-community/` sends visitors to the real hosted Buzz signup
  (`https://app.builderlab.xyz`, Auth0-backed) since buzz.xyz itself has no
  signup/login path — verified by fetching its production bundle directly,
  not assumed.
- Per-OS desktop download resolution (`download-assets.ts`) replicates the
  asset-matching regexes and GitHub Releases API call
  (`api.github.com/repos/block/buzz/releases`) found in Buzz's own shipped
  `BuzzDownloadLink` component — reverse-engineered from their production JS
  bundle, not guessed. Server-side OS detection (`platform.ts`, from the
  `user-agent` header) picks the initial view; architecture (arm64 vs x64 on
  Mac) can't be read from a UA string, so the client resolves it at click
  time via the same GitHub API call, falling back to the releases page on
  any failure — never a fabricated direct file URL.

## Two agents commit to main — ownership map

Two autonomous agents work this repo concurrently: this one (bridge /
directory / shared channels) and a presence agent (auto-join, invite
harvest, LLM community summaries). Every collision so far — a duplicate
migration number, a broken test on main, duplicated NIP-42 work — happened
in the SHARED row below. Main now has branch protection (strict status
checks, "Verify application" required, branches must be up to date before
merging), so GitHub enforces the rebase; you still need to know what's safe
to touch without coordinating.

| Owner | Paths |
| --- | --- |
| Bridge / directory (this agent) | `src/shared-channels/`, `src/hosted-signup/`, `app/shared-channels/`, `app/submit/`, `app/create-community/`, `src/submissions/`, `src/directory/`, `src/db/join-probes.ts`, `src/jobs/probe-joinability.ts` |
| Presence agent | `src/presence/`, `src/jobs/auto-join-communities.ts`, `src/jobs/harvest-invites.ts`, `src/jobs/refresh-community-summaries.ts`, `src/jobs/refresh-invites.ts` |
| SHARED — rebase immediately before touching, keep the diff minimal | `migrations/`, `vitest.config.ts`, `app/SiteMasthead.tsx`, `PRODUCT.md`, `README.md`, `package.json`, `.github/workflows/`, `src/db/` |

New migrations use a timestamp prefix (`YYYYMMDDTHHmm_name.sql`), not the
next number in the old sequence — see `migrations/README.md`. Existing
`000N_` files keep their numbers forever; never rename them.

## Hosted-community "Create" flow (Builderlab)

- `src/hosted-signup/` binds a SELF-GENERATED Nostr key to Block's hosted Buzz
  (Builderlab) and creates a hosted community owned by it — no desktop app, no
  key-provenance check (proven live 2026-07-31). The whole HTTP contract lives
  in ONE place, `builderlab-client.ts`, with the kind-24243 binding event shape
  and every path cited from Block's `github.com/block/buzz` source in comments.
  The exact shapes are NOT re-derivable from this repo — trust that file's
  citations. `create-community.ts` orchestrates the sequence.
- `signed_payload` on `/verify` is the raw event JSON as a STRING (not
  `v1.`+base64url), and the kind-24243 tag ORDER is load-bearing (the server
  recomputes the event id). Custody reuses `encryptConnectorPrivateKey` from
  `shared-channels/store.ts`, scoped to the bind PUBKEY as AAD (available before
  the community exists) — the secret is never returned, logged, or stored in
  plaintext.
- Ordered to be RECOVERABLE: validate name → check availability → encrypt +
  PERSIST the key → bind → create. The key is durably persisted BEFORE the
  irreversible bind, so a post-bind failure never loses it; a retry resumes with
  `existingSecretKey` and tolerates `identity_already_bound` only after `/current`
  confirms the bound identity is ours.
- Live calls are opt-in: `resolveLiveBuilderlabConfig` (and the
  `BuilderlabClient` constructor when the base URL is the real host) refuse
  unless `BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE=1`. Tests inject a fake endpoint +
  fake fetch and never touch the real service. The one interactive step (OAuth
  login → `exchangeLoginCode`) is deliberately NOT automated.

## List-a-community intake (`app/submit/`)

- The intake form (`app/submit/SubmitForm.tsx`, client) collects contact
  email (required), community name, one-line description, an audience
  blurb, and optional focus/categories — stored pre-verification on
  `community_sources` (`source_contact_email`, `source_audience`,
  `source_focus` added in `migrations/20260801T1000_submission_intake.sql`; name/
  description/categories reuse the existing `source_display_name` /
  `source_description` / `source_categories` columns from
  `migrations/0005_catalog_discovery.sql`). `communities.description`/
  `categories`/`focus` aren't touched — those rows don't exist until claim
  (`src/claims/store.ts`), and nothing currently promotes `community_sources`
  submission data onto them; the public directory only reads `catalog`
  sources typed `'buzzdir'` (`src/db/directory.ts`), not `'submission'`.
- Focus options come from `src/ranking/focus.ts` (`FOCUS_SLUGS`); categories
  from `src/submissions/categories.ts` (`SUBMISSION_CATEGORY_SLUGS`) — kept
  import-free so a client component can use it without pulling in
  `src/db/candidates.ts`'s Node-only imports (`node:crypto`).
- `GET /api/submissions/prefill?relayUrl=` (`src/db/directory.ts`'s
  `getSubmissionPrefill`) looks up already-known display name/description/
  categories/focus for a relay that's already a candidate (from prior
  discovery, probes, or a claimed public listing), so a submitter isn't
  asked to retype what BuzzRouter already knows. It does not live-fetch
  NIP-11 from the relay; unknown relays just get an empty form.
- `POST /api/submissions` requires a valid contact email
  (`src/submissions/validation.ts`'s `parseContactEmail`) and rejects
  otherwise with `?status=invalid`; the `source_locator` written alongside
  every source row must be `https://` (`src/discovery/source-locator.ts`),
  so posting the form against a plain-`http://` dev server always fails with
  `?status=failed` — this is pre-existing and unrelated to the submitted
  fields, not a regression to chase. `e2e/submit-intake.spec.ts` covers
  client-side validation/prefill instead of a full submit-to-DB round trip
  for this reason.
- A submitter can also upload a logo, written straight into the existing
  `community_icons` table (candidate_id PK, served by
  `app/api/community-icons/[candidateId]/route.ts`) — the same place the
  NIP-11 probe-icon path (`recordProbeResult` in `src/db/candidates.ts`)
  writes to. Both now go through the shared `upsertCommunityIcon`, and both
  validate through `src/discovery/nip11.ts`'s magic-byte signature check
  (`hasExpectedImageSignature`) rather than trusting a declared content
  type — `parsePublicIconDataUri` for the NIP-11 data-URI icon,
  `parseUploadedIcon` for a direct upload. The size cap and allowed-type
  list (`png`/`jpeg`/`gif`/`webp`, deliberately no `svg` — it's executable)
  live in the import-free `src/discovery/image-types.ts` so the client form
  can enforce the same rule before ever hitting the server.
- `POST /api/submissions` accepts `multipart/form-data` for the logo case
  and legacy `application/x-www-form-urlencoded` for logo-less posts (still
  what the existing unit/integration tests send). In
  `readBoundedBody` (`app/api/submissions/route.ts`), do not
  `reader.cancel()` a stream once the size cap is exceeded — cancelling a
  `FormData`-sourced `Request` body mid-read races undici's internal pull
  loop and throws `"ReadableStream is already closed"` as an unhandled
  rejection (reproduces reliably under Vitest, not just in production);
  drain to completion instead and throw only after the loop ends.

## Directory "joinable" = make the join work, don't hide the community

- Holding an invite code is not proof a bare deep link (`buzz://join?relay&code`)
  joins: Buzz gates most joins behind a ToS/age handshake, and a bare claim is
  refused `403 join_policy_required` (measured live). But that gate is ONE consent
  click, not a closed door — so we make the join work rather than hiding the
  community. Measured facts (see the receipt-findings brief / `store` tests):
  `POST /api/invites/accept-policy {code, policy_version, age_confirmed}` mints a
  receipt bound to **(code, policy version, expiry) with NO pubkey**, so a
  server-minted receipt admits a key we never see; the deep link
  `buzz://join?relay&code&policy_receipt=<receipt>` is what the mobile app reads.
  The receipt is SHORT-LIVED (~10 min) — never cache, store, precompute, or bake
  it into a page; mint it at the consent click.
- The consent flow: `/join/[candidateId]` (`app/join/`) renders the ACTUAL policy
  and an UNTICKED age/ToS checkbox; only on a real tick does the client POST
  `/api/invite-receipt`, which mints via accept-policy and returns the receipt,
  and the client builds the deep link and hands off. `age_confirmed` is the human's
  answer — never defaulted/hardcoded. The endpoint 409s on a policy-version drift
  so the user re-reviews. SSRF: the relay host + code come from our own record for
  the candidate id (`getCandidateInviteTarget`), never caller input.
- Claimability is still probed + stored (`community_join_probes`,
  `src/db/join-probes.ts`; hourly `directory.probe-joinability` job) with the same
  cheap signal — the public `GET /api/join-policy` age flag settles a community as
  `policy_gated` with no claim; only an un-gated community costs one bare claim.
  But the verdict now RECLASSIFIES rather than hides: `src/db/directory.ts`
  exposes `joinStatus` (fresh 12h window, pinned to the advertised code), and
  `?joinable=true` includes everything with a code EXCEPT a proven-`restricted`
  (owner-only/allowlist) one. `policy_gated`/`stale`/unprobed stay joinable (they
  route through the consent flow); only `restricted` is withheld and shown as
  "Request an invite" (`app/joinability-view.ts`). Auto-join reuses `?joinable=true`.
- Verify the receipt chain live before trusting reasoning: gated script
  `scripts/verify-receipt-join.ts` (`BUZZROUTER_VERIFY_RECEIPT_JOIN_LIVE=1`) runs
  policy→accept→deep-link→claim against a real community and asserts 200 joined.
  It consumes one invite use on success; run once, never loop (10 claims/60s cap).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
