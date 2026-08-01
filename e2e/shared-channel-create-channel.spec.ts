import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

// The bridge's create-channel round trip runs INSIDE the app server, which opens
// a real wss:// handshake to the in-process fake relay. The app server already
// trusts the fake cert (playwright.config webServer.env). Trust it here too, in
// case any assertion path in this process touches TLS — no verification is
// disabled.
process.env.NODE_EXTRA_CA_CERTS = resolve("e2e/fixtures/fake-relay-cert.pem");

import { expect, test } from "@playwright/test";
import type { EventTemplate } from "nostr-tools/core";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { Pool } from "pg";

import { encryptConnectorPrivateKey } from "../src/shared-channels/store";

import { startFakeRelay, type FakeRelay } from "./support/fake-relay";

/**
 * The DEFAULT link flow: the owner does NOT pre-make a channel. They pick a
 * destination and send the invitation, and the bridge creates a dedicated
 * channel (kind 9007) named after the peer, hands ownership to the owner (kind
 * 9000), and steps itself down to a member (kind 9000). This drives that through
 * the real UI + API + connector against the fake relay, then asserts the relay
 * actually saw the create and the ownership handoff.
 */

// The committed test wrapping key (version 1) is 32 bytes of 0x07 — see
// e2e/fixtures/connector-wrapping-keys.json — so a connection seeded with a key
// encrypted under it decrypts inside the app server exactly as production would.
const WRAPPING_KEY = Buffer.alloc(32, 7);

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

interface Owner {
  bridgePubkey: string;
  communityId: string;
  privateKey: Uint8Array;
  pubkey: string;
}

const source = createOwner(1);
const destination = createOwner(2);
let pool: Pool;
let relay: FakeRelay;

test.beforeAll(async () => {
  pool = new Pool({ connectionString: databaseUrl });
  relay = await startFakeRelay([]);
  await seed(pool, relay.url, source, destination);
});

test.afterAll(async () => {
  await relay?.close();
  await pool?.end();
});

test("the bridge creates and hands off a dedicated channel for a link", async ({
  page,
}) => {
  await installSigner(page, source);

  await page.goto("/shared-channels");
  await page.getByRole("button", { name: "Connect signer" }).click();
  await expect(page.getByLabel("Community", { exact: true })).toHaveValue(
    source.communityId,
  );

  await page
    .getByLabel("Destination community")
    .selectOption(destination.communityId);

  // "Create a new channel for this link" is the default — no channel picking.
  await expect(
    page.getByRole("radio", { name: "Create a new channel for this link" }),
  ).toBeChecked();

  await page.getByLabel("Shared name").fill("benchmark-review");
  await page
    .getByLabel("Purpose")
    .fill("Review benchmark methodology across both communities.");
  await page.getByRole("button", { name: "Send invitation" }).click();

  // Creating + handing off the channel involves the connector's bounded NIP-42
  // settle wait plus three relay round trips, so allow generous time.
  await expect(page.getByText("Invitation sent.")).toBeVisible({
    timeout: 20_000,
  });

  // The relay really created a channel, named after the peer community.
  const created = relay
    .channels()
    .find((channel) => channel.name === "E2E Beta");
  expect(created).toBeTruthy();

  // Ownership landed with the human who asked for the link; the bot stepped down
  // to a plain member and does NOT linger as owner of a channel in the community.
  const roster = new Map(
    relay.roster().map((member) => [member.pubkey, member.role]),
  );
  expect(roster.get(source.pubkey)).toBe("owner");
  expect(roster.get(source.bridgePubkey)).toBe("member");
});

function createOwner(marker: number): Owner {
  const privateKey = new Uint8Array(32);
  privateKey[31] = marker;
  return {
    bridgePubkey: "",
    communityId: "",
    privateKey,
    pubkey: getPublicKey(privateKey),
  };
}

async function installSigner(
  page: import("@playwright/test").Page,
  owner: Owner,
): Promise<void> {
  await page.exposeFunction("__testGetPublicKey", () => owner.pubkey);
  await page.exposeFunction("__testSignEvent", (template: EventTemplate) =>
    finalizeEvent(template, owner.privateKey),
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
}

async function seed(
  database: Pool,
  relayUrl: string,
  sourceOwner: Owner,
  destinationOwner: Owner,
): Promise<void> {
  await database.query(`
    TRUNCATE
      bridge_channel_handoffs,
      shared_channel_audit_events,
      shared_channel_confirmations,
      shared_channel_endpoints,
      shared_channels,
      connection_install_tokens,
      community_connections,
      communities,
      community_candidates,
      nostr_auth_events
    CASCADE
  `);

  // Source community has an ACTIVE connection whose relay is the fake relay and
  // whose bridge key decrypts under the committed test wrapping key.
  const candidateA = await insertCandidate(database, relayUrl, "alpha.e2e");
  sourceOwner.communityId = await insertCommunity(
    database,
    candidateA,
    "e2e-alpha",
    "E2E Alpha",
    sourceOwner.pubkey,
  );
  const bridgeKey = randomBytes(32);
  sourceOwner.bridgePubkey = getPublicKey(bridgeKey);
  await insertConnection(
    database,
    sourceOwner.communityId,
    relayUrl,
    bridgeKey,
    sourceOwner.bridgePubkey,
  );

  // Destination community: a verified, open peer to link with. It needs an
  // active connection to appear in the destination list, but the propose never
  // touches its relay (its endpoint stays pending until accepted).
  const candidateB = await insertCandidate(
    database,
    "wss://beta.e2e.example",
    "beta.e2e",
  );
  destinationOwner.communityId = await insertCommunity(
    database,
    candidateB,
    "e2e-beta",
    "E2E Beta",
    destinationOwner.pubkey,
  );
  const bridgeKeyB = randomBytes(32);
  await insertConnection(
    database,
    destinationOwner.communityId,
    "wss://beta.e2e.example",
    bridgeKeyB,
    getPublicKey(bridgeKeyB),
  );
}

async function insertConnection(
  database: Pool,
  communityId: string,
  relayUrl: string,
  bridgeKey: Uint8Array,
  bridgePubkey: string,
): Promise<void> {
  const encrypted = encryptConnectorPrivateKey(
    bridgeKey,
    WRAPPING_KEY,
    communityId,
  );
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
      VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', 'healthy', now())
    `,
    [
      communityId,
      relayUrl,
      bridgePubkey,
      encrypted.ciphertext,
      encrypted.nonce,
      encrypted.authTag,
    ],
  );
}

async function insertCandidate(
  database: Pool,
  relayUrl: string,
  host: string,
): Promise<string> {
  const result = await database.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [relayUrl, host],
  );
  return result.rows[0].id;
}

async function insertCommunity(
  database: Pool,
  candidateId: string,
  slug: string,
  displayName: string,
  ownerPubkey: string,
): Promise<string> {
  const result = await database.query<{ id: string }>(
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
      VALUES ($1, $2, 'public', 'admin_verified', $3, $4, $5, ARRAY['research'], now(), true)
      RETURNING id
    `,
    [candidateId, slug, ownerPubkey, displayName, `${displayName} community`],
  );
  return result.rows[0].id;
}
