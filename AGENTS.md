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
  (`npm run test:e2e`, needs `TEST_DATABASE_URL`).
- **Run `npm run build` yourself before Playwright.** `playwright.config.ts`'s
  `webServer.command` is `npm run start`, which serves whatever is already in
  `.next` — it does NOT build. A stale `.next` fails nearly every spec with
  "element(s) not found" on pages that are actually fine; that reads as ~18
  product bugs and is really one missing build.
- **Android emulator harness** — `scripts/android-harness.sh` (boot / open /
  shot / handlers / stop). The join flow's last hop is a `buzz://` deep link to
  a phone, which Playwright cannot see. Use it to render mobile pages and inspect
  the native handoff. Buzz mobile must already be installed and paired before it
  can handle joins. `scripts/pair-android-buzz.ts` implements the desktop side of
  Buzz's NIP-AB flow and pairs the existing emulator to a fresh in-memory
  throwaway identity; it never prints or persists the nsec, pairing URI, session
  secret, ciphertext, or receipt. Run it with `node --import tsx`, an HTTPS
  `--identity-relay`, and the existing emulator serial. Never supply the
  production bridge key. Buzz ships no Android artifact on GitHub Releases, so
  install from the Play Store or a source build before using either harness.
- If TCP auth to the system Postgres isn't set up, connect over the local
  unix socket instead (peer auth matches your OS user to a same-named role):
  `postgresql://<os-user>@/<dbname>?host=/var/run/postgresql`.
- `e2e/shared-channel-signer-free.spec.ts` drives the hub journey from invite
  admission through connector activation, channel selection, and active
  participant settings using the in-process fake relay.

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

## Open BuzzRouter hub

- Connect is hub-only. There is no bilateral proposal, acceptance, typed code, or
  roster-auth confirmation path. A private pair is the same hub endpoint with
  `filter_mode = 'only_these'` and exactly one community in `filter_list`.
- `POST /api/community-connections/begin-from-invite` is unsigned: the pasted
  owner/admin invite identifies the verified community, admits its per-community
  bridge, activates the connector, and mints a short-lived owner session. Invite
  claim URLs remain pinned to the community's on-record relay; never weaken that
  SSRF boundary or log the bearer invite code.
- After activation, `GET /api/shared-channels/local-channels` lists the
  community's actual relay channels. `POST /api/shared-channels/hub` binds the
  selected channel immediately with sends/receives on. The link-step copy is the
  disclosure and the owner-level invite is the consent.
- The hub is one `shared_channels` row with N `participant` endpoints. Each
  endpoint owns `sends`, `receives`, one `filter_mode`, and one UUID
  `filter_list`. Fan-out creates one ordinary `bridge_deliveries` row/job per
  eligible destination, preserving the existing retry and relay-ack semantics.
- Mirrored kind-9 content starts with the source actor's kind-0 display name and
  community. `NostrRelayConnection.getProfileName` caches pubkey-to-name on the
  actor's own relay; only a missing profile falls back to a pubkey prefix. Because
  names are user-controlled, `createDestinationProjection` must escape every
  body line matching the attribution grammar before prepending the real line.
- The invite-claim contract lives in the separate Buzz relay repository:
  `POST https://<relay-host>/api/invites/claim`, NIP-98 signed by the joining
  bridge key, body `{"code":"<code>"}`. This repo cannot implement the
  relay-side rule that newly admitted members enter `general`.
- E2E is `e2e/shared-channel-signer-free.spec.ts`; DB fan-out/filter coverage is
  `src/shared-channels/store.integration.test.ts`.

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
| Bridge / directory (this agent) | `src/shared-channels/`, `app/shared-channels/`, `app/submit/`, `src/submissions/`, `src/directory/`, `src/db/join-probes.ts`, `src/jobs/probe-joinability.ts` |
| Presence agent | `src/presence/`, `src/jobs/auto-join-communities.ts`, `src/jobs/harvest-invites.ts`, `src/jobs/refresh-community-summaries.ts`, `src/jobs/refresh-invites.ts` |
| SHARED — rebase immediately before touching, keep the diff minimal | `migrations/`, `vitest.config.ts`, `app/SiteMasthead.tsx`, `PRODUCT.md`, `README.md`, `package.json`, `.github/workflows/`, `src/db/` |

New migrations use a timestamp prefix (`YYYYMMDDTHHmm_name.sql`), not the
next number in the old sequence — see `migrations/README.md`. Existing
`000N_` files keep their numbers forever; never rename them.

## List-a-community intake (`app/submit/`)

- The intake form (`app/submit/SubmitForm.tsx`, client) collects contact
  email (required), community name, one-line description, an audience
  blurb, and optional focus/categories — stored pre-verification on
  `community_sources` (`source_contact_email`, `source_audience`,
  `source_focus` added in `migrations/20260801T1000_submission_intake.sql`; name/
  description/categories reuse the existing `source_display_name` /
  `source_description` / `source_categories` columns from
  `migrations/0005_catalog_discovery.sql`). `communities.description`/
  `categories`/`focus` aren't touched, and nothing currently promotes
  `community_sources` submission data onto them; the public directory only reads `catalog`
  sources typed `'buzzdir'` (`src/db/directory.ts`), not `'submission'`.
- Focus options come from `src/ranking/focus.ts` (`FOCUS_SLUGS`); categories
  from `src/submissions/categories.ts` (`SUBMISSION_CATEGORY_SLUGS`) — kept
  import-free so a client component can use it without pulling in
  `src/db/candidates.ts`'s Node-only imports (`node:crypto`).
- `GET /api/submissions/prefill?relayUrl=` (`src/db/directory.ts`'s
  `getSubmissionPrefill`) looks up already-known display name/description/
  categories/focus for a relay that's already a candidate (from prior
  discovery, probes, or catalog metadata), so a submitter isn't
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
  It consumes one invite use on success; run once, never loop (10 claims per 60s cap).

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
