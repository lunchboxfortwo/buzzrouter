import { expect, test } from "@playwright/test";
import type { EventTemplate } from "nostr-tools/core";
import {
  finalizeEvent,
  getPublicKey,
} from "nostr-tools/pure";
import { Pool } from "pg";

interface Owner {
  communityId: string;
  privateKey: Uint8Array;
  pubkey: string;
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

const ownerA = createOwner(1);
const ownerB = createOwner(2);
let pool: Pool;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  await seedCommunities(pool, ownerA, ownerB);
});

test.afterAll(async () => {
  await pool?.end();
});

test("owners control their side of a shared-channel route", async ({
  page,
}) => {
  let activeOwner = ownerA;
  await page.exposeFunction("__testGetPublicKey", () => activeOwner.pubkey);
  await page.exposeFunction(
    "__testSignEvent",
    (template: EventTemplate) =>
      finalizeEvent(template, activeOwner.privateKey),
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
  await expect(page.getByLabel("Community", { exact: true })).toHaveValue(
    ownerA.communityId,
  );

  await page
    .getByLabel("Destination community")
    .selectOption(ownerB.communityId);
  await page.getByLabel("Shared name").fill("benchmark-review");
  await page.getByLabel("Local channel ID").first().fill("channel-owner-a");
  await page
    .getByLabel("Local channel name")
    .first()
    .fill("benchmark-review");
  await page
    .getByLabel("Purpose")
    .fill("Review benchmark methodology across both communities.");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  activeOwner = ownerB;
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByLabel("Community", { exact: true })).toHaveValue(
    ownerB.communityId,
  );
  let route = page.locator("article").filter({
    hasText: "benchmark-review",
  });
  await route.getByLabel("Local channel ID").fill("channel-owner-b");
  await route.getByLabel("Local channel name").fill("external-benchmark");
  await route.getByRole("button", { name: "Accept" }).click();
  await expect(page.getByText("Shared channel active.")).toBeVisible();

  activeOwner = ownerA;
  await page.getByRole("button", { name: "Refresh" }).click();
  route = page.locator("article").filter({
    hasText: "benchmark-review",
  });
  await route.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Your endpoint is paused.")).toBeVisible();

  activeOwner = ownerB;
  await page.getByRole("button", { name: "Refresh" }).click();
  route = page.locator("article").filter({
    hasText: "benchmark-review",
  });
  await expect(route).toContainText("peer paused");
  await expect(
    route.getByRole("button", { name: "Resume" }),
  ).toHaveCount(0);

  activeOwner = ownerA;
  await page.getByRole("button", { name: "Refresh" }).click();
  route = page.locator("article").filter({
    hasText: "benchmark-review",
  });
  await route.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Your endpoint is active.")).toBeVisible();

  activeOwner = ownerB;
  await page.getByRole("button", { name: "Refresh" }).click();
  route = page.locator("article").filter({
    hasText: "benchmark-review",
  });
  await route.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.getByText("Shared channel disconnected.")).toBeVisible();
  await expect(route).toContainText("disconnected");

  activeOwner = ownerA;
  await page.getByRole("button", { name: "Refresh" }).click();
  route = page.locator("article").filter({
    hasText: "benchmark-review",
  });
  await expect(route).toContainText("disconnected");
  await expect(
    route.getByRole("button", { name: "Disconnect" }),
  ).toHaveCount(0);

  await page.setViewportSize({ height: 844, width: 390 });
  await expect(route).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
});

function createOwner(marker: number): Owner {
  const privateKey = new Uint8Array(32);
  privateKey[31] = marker;
  return {
    communityId: "",
    privateKey,
    pubkey: getPublicKey(privateKey),
  };
}

async function seedCommunities(
  database: Pool,
  ...owners: Owner[]
): Promise<void> {
  await database.query(`
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

  for (const [index, owner] of owners.entries()) {
    const suffix = index === 0 ? "alpha" : "beta";
    const candidate = await database.query<{ id: string }>(
      `
        INSERT INTO community_candidates (
          canonical_relay_url,
          host,
          state
        )
        VALUES ($1, $2, 'verified_buzz')
        RETURNING id
      `,
      [`wss://${suffix}.e2e.example`, `${suffix}.e2e.example`],
    );
    const community = await database.query<{ id: string }>(
      `
        INSERT INTO communities (
          candidate_id,
          slug,
          visibility,
          claim_state,
          owner_pubkey,
          display_name,
          description,
          categories,
          listed_at
        )
        VALUES (
          $1,
          $2,
          'public',
          'admin_verified',
          $3,
          $4,
          $5,
          ARRAY['research'],
          now()
        )
        RETURNING id
      `,
      [
        candidate.rows[0].id,
        `e2e-${suffix}`,
        owner.pubkey,
        `E2E ${suffix}`,
        `Deterministic ${suffix} community`,
      ],
    );
    owner.communityId = community.rows[0].id;
    const connectorKey = createOwner(index + 10);
    await database.query(
      `
        INSERT INTO community_connections (
          community_id,
          relay_url_snapshot,
          bridge_pubkey,
          encrypted_private_key,
          private_key_nonce,
          private_key_auth_tag,
          wrapping_key_version,
          state,
          health,
          activated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          1,
          'active',
          'healthy',
          now()
        )
      `,
      [
        owner.communityId,
        `wss://${suffix}.e2e.example`,
        connectorKey.pubkey,
        Buffer.alloc(32, index + 1),
        Buffer.alloc(12, index + 1),
        Buffer.alloc(16, index + 1),
      ],
    );
  }
}
