import { expect, test } from "@playwright/test";
import type { EventTemplate } from "nostr-tools/core";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { Pool } from "pg";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

const privateKey = new Uint8Array(32);
privateKey[31] = 3;
const pubkey = getPublicKey(privateKey);

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
  await page.exposeFunction("__testGetPublicKey", () => pubkey);
  await page.exposeFunction(
    "__testSignEvent",
    (template: EventTemplate) => finalizeEvent(template, privateKey),
  );
  await page.addInitScript(() => {
    const testWindow = window as unknown as Window & {
      __testGetPublicKey(): Promise<string>;
      __testSignEvent(
        template: EventTemplate,
      ): Promise<Record<string, unknown>>;
      nostr?: {
        getPublicKey(): Promise<string>;
        signEvent(
          template: EventTemplate,
        ): Promise<Record<string, unknown>>;
      };
    };
    testWindow.nostr = {
      getPublicKey: () => testWindow.__testGetPublicKey(),
      signEvent: (template) => testWindow.__testSignEvent(template),
    };
  });

  await page.goto("/shared-channels");
  await page.getByRole("button", { name: "Connect signer" }).click();
  await expect(page.getByText("No owned communities")).toBeVisible();

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
  await page.exposeFunction("__testGetPublicKey", () => pubkey);
  await page.exposeFunction(
    "__testSignEvent",
    (template: EventTemplate) => finalizeEvent(template, privateKey),
  );
  await page.addInitScript(() => {
    const testWindow = window as unknown as Window & {
      __testGetPublicKey(): Promise<string>;
      __testSignEvent(
        template: EventTemplate,
      ): Promise<Record<string, unknown>>;
      nostr?: {
        getPublicKey(): Promise<string>;
        signEvent(
          template: EventTemplate,
        ): Promise<Record<string, unknown>>;
      };
    };
    testWindow.nostr = {
      getPublicKey: () => testWindow.__testGetPublicKey(),
      signEvent: (template) => testWindow.__testSignEvent(template),
    };
  });

  await page.goto("/shared-channels");
  await page.getByRole("button", { name: "Connect signer" }).click();
  await page
    .getByLabel("Search communities to claim")
    .fill("no-such-community-anywhere");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("link", { name: "Submit it" })).toHaveAttribute(
    "href",
    "/submit",
  );
});
