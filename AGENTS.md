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

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
