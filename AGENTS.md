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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
