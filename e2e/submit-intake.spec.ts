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

test("points a queued owner to Connect with their admin invite", async ({
  page,
}) => {
  await page.goto("/submit?status=queued");

  const connect = page
    .getByRole("status")
    .getByRole("link", { name: "Connect" });
  await expect(connect).toHaveAttribute(
    "href",
    "/shared-channels#invite-link",
  );
  await expect(page.getByText(/owner\/admin invite from your community/i)).toBeVisible();
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

const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

test.describe("logo upload", () => {
  test("previews an accepted image and keeps the rest of the form", async ({
    page,
  }) => {
    await page.goto("/submit");

    await page.getByLabel("Community name").fill("Logo Test Community");
    await page.getByLabel("Logo (optional)").setInputFiles({
      buffer: ONE_PIXEL_PNG,
      mimeType: "image/png",
      name: "logo.png",
    });

    const preview = page.getByRole("region", { name: "Listing preview" });
    await expect(preview.locator("img")).toBeVisible();
    await expect(preview).toContainText("Logo Test Community");
  });

  test("rejects a disallowed file type client-side without losing typed fields", async ({
    page,
  }) => {
    await page.goto("/submit");

    await page.getByLabel("Community name").fill("Keep Me Typed");
    await page.getByLabel("Logo (optional)").setInputFiles({
      buffer: Buffer.from("<svg onload=alert(1)></svg>"),
      mimeType: "image/svg+xml",
      name: "logo.svg",
    });

    await expect(
      page.getByText("Logo must be a PNG, JPEG, GIF, or WEBP image."),
    ).toBeVisible();
    await expect(page.getByLabel("Community name")).toHaveValue(
      "Keep Me Typed",
    );
    await expect(
      page.getByRole("region", { name: "Listing preview" }).locator("img"),
    ).toHaveCount(0);
  });

  test("rejects an oversize file client-side", async ({ page }) => {
    await page.goto("/submit");

    await page.getByLabel("Logo (optional)").setInputFiles({
      buffer: Buffer.alloc(300 * 1024, 1),
      mimeType: "image/png",
      name: "big-logo.png",
    });

    await expect(page.getByText("Logo must be under 256KB.")).toBeVisible();
  });

  test("leaves the form free of errors when no logo is chosen", async ({
    page,
  }) => {
    // The logo is optional: a submission must still work without one. The
    // full round trip to "queued" (no logo required) is covered by
    // app/api/submissions/route.integration.test.ts, which also asserts no
    // community_icons row is created for a logo-less submission.
    await page.goto("/submit");

    await expect(page.getByText(/Logo must be/)).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Listing preview" }).locator("img"),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Queue verification" }),
    ).toBeEnabled();
  });
});
