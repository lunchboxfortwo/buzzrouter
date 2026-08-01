import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

let pool: Pool;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  await pool.query(
    "TRUNCATE community_sources, community_candidates CASCADE",
  );

  const candidate = await pool.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'discovered')
      RETURNING id
    `,
    ["wss://prefill.e2e.example", "prefill.e2e.example"],
  );
  await pool.query(
    `
      INSERT INTO community_sources (
        candidate_id,
        source_type,
        source_locator,
        source_observed_at,
        evidence_hash,
        source_display_name,
        source_description,
        source_categories
      )
      VALUES ($1, 'buzzdir', $2, now(), $3, $4, $5, $6)
    `,
    [
      candidate.rows[0].id,
      "https://buzz.xyz/prefill-e2e",
      "e2e-prefill-hash",
      "E2E Prefill Community",
      "A community used to prove the intake form prefills.",
      ["culture"],
    ],
  );
});

test.afterAll(async () => {
  await pool?.end();
});

test("collects contact email and requires it before submitting", async ({
  page,
}) => {
  await page.goto("/submit");

  await expect(page.getByLabel("Community name")).toBeVisible();
  await expect(page.getByLabel("What it does")).toBeVisible();
  await expect(page.getByLabel("Who it's for")).toBeVisible();
  await expect(page.getByLabel("Focus (optional)")).toBeVisible();

  const emailInput = page.getByLabel("Contact email");
  await expect(emailInput).toHaveAttribute("required", "");

  await page.getByLabel("Relay or invite URL").fill("wss://no-email.e2e.example");
  await page.getByRole("button", { name: "Queue verification" }).click();

  // The browser blocks submission on the missing required email field, so
  // the page never navigates away from /submit.
  await expect(page).toHaveURL(/\/submit$/);
});

test("prefills known catalog metadata once the relay is entered", async ({
  page,
}) => {
  await page.goto("/submit");

  await page
    .getByLabel("Relay or invite URL")
    .fill("wss://prefill.e2e.example");

  await expect(page.getByLabel("Community name")).toHaveValue(
    "E2E Prefill Community",
  );
  await expect(page.getByLabel("What it does")).toHaveValue(
    "A community used to prove the intake form prefills.",
  );
  await expect(page.getByRole("checkbox", { name: "Culture" })).toBeChecked();

  await expect(
    page.getByRole("region", { name: "Listing preview" }),
  ).toContainText("E2E Prefill Community");
  await expect(
    page.getByRole("region", { name: "Listing preview" }),
  ).toContainText("A community used to prove the intake form prefills.");
});

test("does not overwrite text the submitter already typed", async ({
  page,
}) => {
  await page.goto("/submit");

  await page.getByLabel("Community name").fill("My Own Name");
  await page
    .getByLabel("Relay or invite URL")
    .fill("wss://prefill.e2e.example");

  await expect(page.getByLabel("What it does")).toHaveValue(
    "A community used to prove the intake form prefills.",
  );
  await expect(page.getByLabel("Community name")).toHaveValue("My Own Name");
});
