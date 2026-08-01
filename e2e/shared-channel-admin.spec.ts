import { expect, test } from "@playwright/test";
import type { EventTemplate } from "nostr-tools/core";
import {
  finalizeEvent,
  getPublicKey,
} from "nostr-tools/pure";
import { Pool } from "pg";

import {
  armSharedChannelConfirmation,
  confirmSharedChannelBinding,
} from "../src/shared-channels/store";

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
  // Bind an existing channel by id rather than the default "create a new one".
  await page
    .getByRole("radio", { name: "Use a channel I already have" })
    .click();
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

  // Accept is chat-proof now: the web click only arms a one-time code, and the
  // bridge binds the route only after reading the code from a roster owner/admin
  // over the relay. This spec's relays are unreachable stubs, so that relay
  // round trip is exercised by shared-channel-unseeded-journey.spec.ts and the
  // store integration tests; here we drive the same store path directly to reach
  // an active route for the endpoint-control assertions below.
  await bindDestinationViaConfirmation(pool, ownerB);
  await page.getByRole("button", { name: "Refresh" }).click();
  route = page.locator("article").filter({
    hasText: "benchmark-review",
  });
  await expect(route).toContainText("active");

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

/**
 * Bind the destination endpoint the way the bridge would after the roster check
 * passes: arm the pending endpoint, then consume its code. Kept at the store
 * layer because this spec's relays are unreachable stubs.
 */
async function bindDestinationViaConfirmation(
  database: Pool,
  owner: Owner,
): Promise<void> {
  const channel = await database.query<{ id: string }>(
    `
      SELECT channels.id
      FROM shared_channels AS channels
      JOIN shared_channel_endpoints AS endpoints
        ON endpoints.shared_channel_id = channels.id
      WHERE endpoints.community_id = $1
        AND endpoints.role = 'destination'
        AND channels.state = 'proposed'
      ORDER BY channels.created_at DESC
      LIMIT 1
    `,
    [owner.communityId],
  );
  const sharedChannelId = channel.rows[0].id;
  await armSharedChannelConfirmation(database, {
    communityId: owner.communityId,
    idempotencyKey: `admin-arm-${sharedChannelId}`,
    localChannelId: "channel-owner-b",
    localChannelName: "external-benchmark",
    ownerPubkey: owner.pubkey,
    sharedChannelId,
  });
  const confirmation = await database.query<{ id: string }>(
    `
      SELECT id
      FROM shared_channel_confirmations
      WHERE shared_channel_id = $1
        AND state = 'pending'
    `,
    [sharedChannelId],
  );
  const result = await confirmSharedChannelBinding(database, {
    actorCreatedAt: Math.floor(Date.now() / 1_000),
    actorEventId: "f".repeat(64),
    actorPubkey: owner.pubkey,
    confirmationId: confirmation.rows[0].id,
  });
  if (!result.activated) {
    throw new Error("Admin route activation failed.");
  }
}

async function seedCommunities(
  database: Pool,
  ...owners: Owner[]
): Promise<void> {
  await database.query(`
    TRUNCATE
      shared_channel_audit_events,
      shared_channel_confirmations,
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
          listed_at,
          open_to_shared_channels
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
          now(),
          true
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
