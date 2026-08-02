import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

let pool: Pool;
let candidateId: string;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  await pool.query(`
    TRUNCATE
      shared_channel_audit_events,
      bridge_event_mappings,
      bridge_deliveries,
      bridge_messages,
      shared_channel_endpoints,
      shared_channels,
      connection_install_tokens,
      community_connections,
      communities,
      community_candidates,
      nostr_auth_events
    CASCADE
  `);
  const candidate = await pool.query<{ id: string }>(
    `
      INSERT INTO community_candidates (
        canonical_relay_url,
        host,
        state
      )
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    ["wss://lookup.e2e.example", "lookup.e2e.example"],
  );
  candidateId = candidate.rows[0].id;
});

test.afterAll(async () => {
  await pool?.end();
});

test("an owner with nothing claimed can reach a claim page without the internal password", async ({
  page,
}) => {
  await page.goto("/shared-channels");
  await page.getByText("Need to claim a community?").click();

  await page
    .getByLabel("Search communities to claim")
    .fill("lookup.e2e.example");
  await page.getByRole("button", { name: "Search" }).click();

  const link = page.getByRole("link", { name: "lookup.e2e.example" });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", `/claim/${candidateId}`);

  await link.click();
  await expect(page).toHaveURL(`/claim/${candidateId}`);
  await expect(page.getByText("Community ownership")).toBeVisible();
});

test("searching for nothing points the owner at /submit", async ({
  page,
}) => {
  await page.goto("/shared-channels");
  await page.getByText("Need to claim a community?").click();
  await page
    .getByLabel("Search communities to claim")
    .fill("no-such-community-anywhere");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("link", { name: "Submit it" })).toHaveAttribute(
    "href",
    "/submit",
  );
});
