import { resolve } from "node:path";

// begin-from-invite runs entirely on the APP server, but the ConnectorSupervisor
// it spins up to publish the kind-0 verification event opens a real wss://
// handshake to the fake relay from the app process — the app server already
// trusts the fixture cert via NODE_EXTRA_CA_CERTS in playwright.config.ts. This
// spec itself opens no relay socket, so it needs no extra CA wiring.
import { expect, test } from "@playwright/test";
import { getPublicKey } from "nostr-tools/pure";
import { Pool } from "pg";

import { startFakeRelay, type FakeRelay } from "./support/fake-relay";

/**
 * The signer-free "Link" journey: a phone with NO browser extension pastes an
 * invite link, admits the bridge, and connects to the BuzzRouter community in
 * one tap — authorized end to end by the pasted invite + the community-scoped
 * session it mints, never a NIP-07 signature.
 *
 * begin-from-invite and connect-featured both run through the REAL app HTTP
 * routes. The one thing not re-driven here is the roster-signed in-channel code
 * that finishes the bind — that authorization branch is covered against a live
 * ConnectorSupervisor in store.integration.test.ts. This spec asserts the arm
 * state the connector would then consume.
 */

const HOME_HOST = "relay.buzzrouter.com";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

const callerOwner = ownerKey(1);
const featuredOwner = ownerKey(2);

let pool: Pool;
let relay: FakeRelay;
let callerCommunityId: string;

test.beforeAll(async () => {
  relay = await startFakeRelay([
    { id: "general", name: "general" },
    { id: "builders", name: "builders" },
  ]);
  pool = new Pool({ connectionString: databaseUrl });
  await resetDatabase(pool);

  // The BuzzRouter community itself: verified, owned, connector already active.
  // Its relay is never dialed in this spec (no supervisor runs here), so a
  // placeholder wss:// is fine — connect-featured only needs the active row.
  const featured = await seedOwnedCommunity(pool, {
    canonicalRelayUrl: "wss://relay.buzzrouter.com",
    displayName: "BuzzRouter",
    host: HOME_HOST,
    ownerPubkey: featuredOwner,
  });
  await seedActiveConnection(pool, featured, "wss://relay.buzzrouter.com");

  // The caller's own community: verified + owned, but NOT yet connected — the
  // invite flow admits the bridge. Its relay IS the live fake relay, so the real
  // redeem (HTTP claim) + activate (kind-0 round trip) run against it.
  callerCommunityId = await seedOwnedCommunity(pool, {
    canonicalRelayUrl: relay.url,
    displayName: "Caller Community",
    host: "caller.signerfree.example",
    ownerPubkey: callerOwner,
  });
  relay.setRoster([{ pubkey: callerOwner, role: "owner" }]);
});

test.afterAll(async () => {
  await pool?.end();
  await relay?.close();
});

test("a phone with no extension links to BuzzRouter from an invite link", async ({
  page,
}) => {
  // The page leads with the signer-free flow — no extension wall gating it.
  await page.goto("/shared-channels");
  await expect(
    page.getByText(
      "Shared channels on Buzz work like shared channels in Slack.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Connect signer" }),
  ).toHaveCount(0);
  await expect(page.getByRole("link", { name: "command line" })).toHaveAttribute(
    "href",
    /admin-without-a-browser-signer\.md$/,
  );
  const inviteField = page.getByLabel("Invite link from your Buzz app");
  await expect(inviteField).toBeVisible();

  // Paste the invite link. begin-from-invite identifies the community from the
  // link's host, the bridge redeems it, and the page reports it connected.
  const invitePort = new URL(relay.url).port;
  await inviteField.fill(`https://127.0.0.1:${invitePort}/invite/opaque-code`);
  await page.getByRole("button", { name: "Add your community" }).click();
  await expect(
    page.getByRole("heading", { name: "Connected: Caller Community" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Routes" })).toBeVisible();

  // Pick the channel to share and take the one-press canonical CTA.
  await page.getByLabel("Channel to share name").fill("general");
  await page.getByLabel("Channel to share ID").fill("general");
  await page
    .getByRole("button", { name: "Connect with the BuzzRouter community" })
    .click();

  // The page shows the one-time code the owner types in their channel to finish.
  await expect(page.getByText("One step left")).toBeVisible();
  const code = (await page.locator("code").first().innerText()).trim();
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

  // The route BuzzRouter proposed to the caller is armed and waiting for the
  // roster-signed code — source (BuzzRouter) active on a caller-scoped channel,
  // destination (caller) still pending until the code lands.
  const endpoints = await pool.query<{
    community_id: string;
    local_channel_id: string | null;
    role: string;
    state: string;
  }>(
    `
      SELECT endpoints.community_id, endpoints.local_channel_id,
             endpoints.role, endpoints.state
      FROM shared_channel_endpoints AS endpoints
      JOIN shared_channels AS channels
        ON channels.id = endpoints.shared_channel_id
      WHERE channels.proposed_name = 'buzzrouter'
      ORDER BY endpoints.role
    `,
  );
  const destination = endpoints.rows.find((row) => row.role === "destination");
  const source = endpoints.rows.find((row) => row.role === "source");
  expect(destination).toMatchObject({
    community_id: callerCommunityId,
    state: "pending",
  });
  expect(source).toMatchObject({
    local_channel_id: `buzzrouter:${callerCommunityId}`,
    state: "active",
  });

  const confirmation = await pool.query<{ count: string }>(
    `
      SELECT count(*)::text AS count
      FROM shared_channel_confirmations
      WHERE community_id = $1 AND state = 'pending'
    `,
    [callerCommunityId],
  );
  expect(confirmation.rows[0].count).toBe("1");
});

function ownerKey(marker: number): string {
  const privateKey = new Uint8Array(32);
  privateKey[31] = marker;
  return getPublicKey(privateKey);
}

async function seedOwnedCommunity(
  database: Pool,
  input: {
    canonicalRelayUrl: string;
    displayName: string;
    host: string;
    ownerPubkey: string;
  },
): Promise<string> {
  const candidate = await database.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [input.canonicalRelayUrl, input.host],
  );
  const community = await database.query<{ id: string }>(
    `
      INSERT INTO communities (
        candidate_id, claim_state, owner_pubkey, display_name,
        open_to_shared_channels
      )
      VALUES ($1, 'admin_verified', $2, $3, true)
      RETURNING id
    `,
    [candidate.rows[0].id, input.ownerPubkey, input.displayName],
  );
  return community.rows[0].id;
}

async function seedActiveConnection(
  database: Pool,
  communityId: string,
  relayUrl: string,
): Promise<void> {
  await database.query(
    `
      INSERT INTO community_connections (
        community_id, relay_url_snapshot, bridge_pubkey,
        encrypted_private_key, private_key_nonce, private_key_auth_tag,
        wrapping_key_version, state, health, activated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 1, 'active', 'healthy', now())
    `,
    [
      communityId,
      relayUrl,
      ownerKey(9),
      Buffer.alloc(32, 3),
      Buffer.alloc(12, 3),
      Buffer.alloc(16, 3),
    ],
  );
}

async function resetDatabase(database: Pool): Promise<void> {
  await database.query(`
    TRUNCATE
      shared_channel_audit_events,
      shared_channel_confirmations,
      connection_owner_sessions,
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
}
