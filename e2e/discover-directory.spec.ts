// Story 1: a visitor browses and searches the directory, and can tell which
// communities they can actually join.
//
// This is the front door and nothing drove it end to end before. It exercises
// the real Discover page: listing, the ?q= search, the joinable/restricted
// split from `joinAffordance`, and the click through to a community profile.
//
// No relay is needed — Discover renders from our own directory rows, so this
// seeds Postgres and drives the shipped UI.
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

let pool: Pool;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  await resetDatabase(pool);

  // Joinable: has an invite code, never probed restricted.
  await seedCommunity(pool, {
    description: "Everyone welcome, come on in.",
    displayName: "Discover Open Community",
    host: "discover-open.e2e.invalid",
    inviteCode: "discover-open-code",
  });

  // Restricted: same invite code shape, but a probe proved admission is
  // owner-only, so the directory must NOT offer a dead-end join button.
  await seedCommunity(pool, {
    description: "Admission is by approval only.",
    displayName: "Discover Locked Community",
    host: "discover-locked.e2e.invalid",
    inviteCode: "discover-locked-code",
    probeStatus: "restricted",
  });

  // Nothing to join with: no invite code at all.
  await seedCommunity(pool, {
    description: "Listed, but no way in from here.",
    displayName: "Discover Listingonly Community",
    host: "discover-listingonly.e2e.invalid",
    inviteCode: null,
  });
});

test.afterAll(async () => {
  await pool.end();
});

// Discover renders a results list plus an inspector panel, and page.tsx
// auto-selects communities[0]. So the selected community's name appears twice —
// scope list assertions to the results list to keep them unambiguous.
const results = (page: import("@playwright/test").Page) =>
  page.getByLabel("Community results");

test("lists communities and shows the right way in for each", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    results(page).getByText("Discover Open Community", { exact: true }),
  ).toBeVisible();
  await expect(
    results(page).getByText("Discover Locked Community", { exact: true }),
  ).toBeVisible();

  // An unrestricted invite code is joinable — a ToS/age gate is one consent
  // click, not a closed door.
  await expect(
    page.getByRole("button", { name: "Join Discover Open Community" }),
  ).toBeVisible();

  // A restricted community says so instead of offering a join that would be
  // refused. The row wording is "Request invite"; the inspector's JoinButton
  // says "Request an invite". There is no join button for it anywhere.
  await expect(results(page).getByText("Request invite")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Join Discover Locked Community" }),
  ).toHaveCount(0);
});

test("search narrows the directory to the matching community", async ({
  page,
}) => {
  await page.goto("/?q=Locked");

  await expect(
    results(page).getByText("Discover Locked Community", { exact: true }),
  ).toBeVisible();
  await expect(
    results(page).getByText("Discover Open Community", { exact: true }),
  ).toHaveCount(0);
});

test("search for something absent does not strand the visitor", async ({
  page,
}) => {
  await page.goto("/?q=zzz-no-such-community-zzz");

  await expect(
    page.getByText("Discover Open Community", { exact: true }),
  ).toHaveCount(0);
  // Whatever the empty state says, the page must still render its nav rather
  // than erroring out.
  await expect(page.getByRole("navigation")).toBeVisible();
});

test("mobile navigation stays on one line and search stays on Discover", async ({
  page,
}) => {
  await page.setViewportSize({ height: 568, width: 320 });
  await page.goto("/");

  const navLinks = page.getByRole("navigation").getByRole("link");
  await expect(navLinks).toHaveText(["Discover", "Link", "List"]);
  const linkTops = await navLinks.evaluateAll((links) =>
    links.map((link) => Math.round(link.getBoundingClientRect().top)),
  );
  expect(new Set(linkTops).size).toBe(1);
  const linkEdges = await navLinks.evaluateAll((links) =>
    links.map((link) => {
      const box = link.getBoundingClientRect();
      return { left: Math.round(box.left), right: Math.round(box.right) };
    }),
  );
  expect(
    Math.min(...linkEdges.map(({ left }) => left)),
  ).toBeGreaterThanOrEqual(0);
  expect(
    Math.max(...linkEdges.map(({ right }) => right)),
  ).toBeLessThanOrEqual(320);
  await expect(
    page.getByPlaceholder("Search communities or topics"),
  ).toBeVisible();

  await page.goto("/submit");
  await expect(
    page.getByPlaceholder("Search communities or topics"),
  ).toHaveCount(0);
});

test("focus is directly available without a search-options disclosure", async ({
  page,
}) => {
  await page.goto("/");

  await expect(
    page.getByLabel("Filter communities").getByLabel("Focus"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Search options" }),
  ).toHaveCount(0);
});

test("the removed Create page stays gone", async ({ page }) => {
  const response = await page.goto("/create-community");

  expect(response?.status()).toBe(404);
});

test("selecting a community shows its details in the inspector", async ({
  page,
}) => {
  await page.goto("/");

  // Picking a row selects it via ?selected= and drives the inspector panel;
  // it does not navigate to a separate profile route. The whole row is a
  // stretched overlay link labelled "View {name}".
  await page
    .getByRole("link", { name: "View Discover Locked Community" })
    .click();

  await expect(page).toHaveURL(/selected=/);
  await expect(
    page.getByRole("heading", { name: "Discover Locked Community" }),
  ).toBeVisible();
  // The description renders twice in the inspector: the summary line and the
  // About section.
  await expect(
    page.getByText("Admission is by approval only.").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("note", { name: /request an invite/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open Discover Locked Community in Buzz" }),
  ).toHaveCount(0);
});

test("selecting a joinable community keeps its join action obvious on mobile", async ({
  page,
}) => {
  await page.setViewportSize({ height: 667, width: 375 });
  await page.goto("/");

  await page
    .getByRole("link", { name: "View Discover Open Community" })
    .click();

  const join = page.getByRole("button", {
    name: "Open Discover Open Community in Buzz",
  });
  await expect(join).toBeVisible();
  await expect(join).toHaveText(/Join in Buzz/);
  const box = await join.boundingBox();
  expect(box).not.toBeNull();
  expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThanOrEqual(667);
});

async function seedCommunity(
  database: Pool,
  input: {
    description: string;
    displayName: string;
    host: string;
    inviteCode: string | null;
    probeStatus?: string;
  },
): Promise<void> {
  const canonicalRelayUrl = `wss://${input.host}`;
  const candidate = await database.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [canonicalRelayUrl, input.host],
  );
  const candidateId = candidate.rows[0].id;

  await database.query(
    `
      INSERT INTO probe_snapshots (
        candidate_id, probed_at, tls_valid, result_code,
        software_version, relay_name, supported_nips
      )
      VALUES ($1, now(), true, 'exact_software_and_protocol', '0.9.0', 'buzz', '[11,29,42]'::jsonb)
    `,
    [candidateId],
  );

  await database.query(
    `
      INSERT INTO community_sources (
        candidate_id, source_type, source_locator, evidence_hash,
        source_display_name, source_description, source_invite_code
      )
      VALUES ($1, 'buzzdir', $2, $3, $4, $5, $6)
    `,
    [
      candidateId,
      `https://${input.host}/`,
      `hash-${input.host}`,
      input.displayName,
      input.description,
      input.inviteCode,
    ],
  );

  if (input.probeStatus && input.inviteCode) {
    await database.query(
      `
        INSERT INTO community_join_probes (candidate_id, probed_code, status, detail, probed_at)
        VALUES ($1, $2, $3, 'e2e seed', now())
      `,
      [candidateId, input.inviteCode, input.probeStatus],
    );
  }
}

async function resetDatabase(database: Pool): Promise<void> {
  await database.query(`
    TRUNCATE
      community_join_probes,
      community_sources,
      probe_snapshots,
      communities,
      community_candidates
    RESTART IDENTITY CASCADE
  `);
}
