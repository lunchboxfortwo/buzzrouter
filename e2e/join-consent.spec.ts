import { randomUUID } from "node:crypto";

// The /join consent page runs entirely on the APP server, which fetches the
// community's join policy and mints the receipt over HTTPS to the fake relay —
// the app already trusts the fixture cert via NODE_EXTRA_CA_CERTS in
// playwright.config.ts. This spec opens no relay socket itself.
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { startFakeRelay, type FakeRelay } from "./support/fake-relay";

/**
 * The receipt-minting consent journey: a user opens a community whose join is
 * behind Buzz's ToS/age gate, sees the actual policy, ticks a genuine consent
 * box, and is handed a working receipt-carrying deep link. Proves the whole
 * chain end to end through the real app: `/join/<id>` → policy display →
 * `/api/invite-receipt` (server accept-policy against the relay) → deep link.
 *
 * The one step not driven here is the app's own claim-with-receipt (that happens
 * inside Buzz on the phone); the receipt's validity against a live claim is
 * covered by the gated live verification script and store-level tests.
 */

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

let pool: Pool;
let relay: FakeRelay;
let candidateId: string;
let relayUrl: string;

test.beforeAll(async () => {
  relay = await startFakeRelay([], {
    joinPolicy: {
      ageAttestationRequired: true,
      privacyMarkdown: "E2E PRIVACY NOTICE — sample.",
      receipt: "e2e-receipt-token",
      termsMarkdown: "E2E TERMS OF SERVICE — sample.",
      version: "e2e-policy-v1",
    },
  });
  relayUrl = relay.url;
  const host = new URL(relay.url).host; // 127.0.0.1:<port>

  pool = new Pool({ connectionString: databaseUrl });
  await pool.query(
    "DELETE FROM community_candidates WHERE canonical_relay_url = $1",
    [relayUrl],
  );
  const candidate = await pool.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [relayUrl, host],
  );
  candidateId = candidate.rows[0].id;
  await pool.query(
    `
      INSERT INTO community_sources
        (candidate_id, source_type, evidence_hash, source_observed_at,
         source_invite_code)
      VALUES ($1, 'harvest', $2, now(), $3)
    `,
    [candidateId, randomUUID(), "v2.e2e-invite-code"],
  );
});

test.afterAll(async () => {
  if (pool) {
    await pool.query(
      "DELETE FROM community_candidates WHERE canonical_relay_url = $1",
      [relayUrl],
    );
    await pool.end();
  }
  await relay?.close();
});

test("shows the real policy and mints a receipt only after a genuine consent tick", async ({
  page,
}) => {
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto(`/join/${candidateId}`);

  // The join page uses the same shell as the rest of BuzzRouter.
  await expect(page.getByRole("navigation")).toBeVisible();
  await expect(page.locator("main")).toHaveCSS(
    "font-family",
    /Instrument Sans/,
  );

  // Desktop has ONE primary path (consent -> Open in Buzz, which carries the
  // receipt so nobody is asked to consent twice). Buzz's own page survives only
  // as a quiet fallback for people who have not installed the app.
  const buzzFallback = page.getByRole("link", {
    name: /page on Buzz/i,
  });
  await expect(buzzFallback).toBeVisible();
  await expect(buzzFallback).toHaveAttribute(
    "href",
    `https://${new URL(relayUrl).host}/invite/v2.e2e-invite-code`,
  );
  await expect(
    page.getByRole("button", { name: /Join without Buzz/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /BuzzRouter holds your key/i }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /Export my key/i }),
  ).toHaveCount(0);

  if (process.env.JOIN_SCREENSHOT_PATH) {
    await page.screenshot({
      fullPage: true,
      path: process.env.JOIN_SCREENSHOT_PATH,
    });
  }

  // The actual policy is shown for review, and its text is reachable.
  await page.getByText("Terms of Service", { exact: true }).click();
  await expect(page.getByText("E2E TERMS OF SERVICE — sample.")).toBeVisible();

  // The join action is gated on a real, unticked consent box.
  const openInBuzz = page.getByRole("button", { name: "Open in Buzz" });
  await expect(openInBuzz).toBeDisabled();

  const consent = page.getByRole("checkbox");
  await expect(consent).not.toBeChecked();
  await consent.check();
  await expect(openInBuzz).toBeEnabled();

  // Consent → the server mints a receipt against the relay's accept-policy.
  const [receiptResponse] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/invite-receipt")),
    openInBuzz.click(),
  ]);
  expect(receiptResponse.status()).toBe(200);
  const body = await receiptResponse.json();
  expect(body.receipt).toBe("e2e-receipt-token");
  expect(body.relayUrl).toBe(relayUrl);
  expect(body.code).toBe("v2.e2e-invite-code");
});

test("does not expose the removed managed-identity API", async ({ request }) => {
  const responses = await Promise.all([
    request.get("/api/identity"),
    request.post("/api/identity/join"),
    request.post("/api/identity/export"),
  ]);

  expect(responses.map((response) => response.status())).toEqual([
    404, 404, 404,
  ]);
});

// A phone visitor is told what they are in for BEFORE they try: joining works
// from a phone, but Buzz mobile cannot create an identity on its own (it pairs
// with desktop), and a new member lands in no channel (block/buzz#4307).
// Desktop must NOT see it — this is a mobile-only caveat, not a site-wide banner.
test("warns phone visitors that reading needs Buzz on desktop", async ({
  browser,
}) => {
  const phone = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { height: 800, width: 390 },
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(`/join/${candidateId}`);
  await expect(
    phonePage.getByRole("note").filter({ hasText: /Finish this on a computer/i }),
  ).toBeVisible();
  await expect(
    phonePage.getByRole("button", { name: /Open in Buzz/i }),
  ).toHaveCount(0);
  await expect(
    phonePage.getByRole("button", { name: /Join without Buzz/i }),
  ).toHaveCount(0);
  await phone.close();

  const desktop = await browser.newContext({
    viewport: { height: 900, width: 1280 },
  });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(`/join/${candidateId}`);
  await expect(
    desktopPage.getByRole("note").filter({ hasText: /Finish this on a computer/i }),
  ).toHaveCount(0);
  // One path per device: the phone gets the notice and no join button at all;
  // desktop gets exactly one primary action.
  await expect(
    desktopPage.getByRole("button", { name: /Open in Buzz/i }),
  ).toBeVisible();
  await desktop.close();
});

// The web path is not a way through on a phone: Buzz's own invite page hands
// off to the same app an unpaired phone cannot use. Desktop keeps it primary.
test("does not push phone visitors at Buzz's page, but keeps it on desktop", async ({
  browser,
}) => {
  const phone = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    viewport: { height: 800, width: 390 },
  });
  const phonePage = await phone.newPage();
  await phonePage.goto(`/join/${candidateId}`);
  await expect(
    phonePage.getByRole("link", { name: /page on Buzz/i }),
  ).toHaveCount(0);
  await phone.close();

  const desktop = await browser.newContext({
    viewport: { height: 900, width: 1280 },
  });
  const desktopPage = await desktop.newPage();
  await desktopPage.goto(`/join/${candidateId}`);
  await expect(
    desktopPage.getByRole("button", { name: /Open in Buzz/i }),
  ).toBeVisible();
  await expect(
    desktopPage.getByRole("link", { name: /page on Buzz/i }),
  ).toBeVisible();
  await desktop.close();
});
