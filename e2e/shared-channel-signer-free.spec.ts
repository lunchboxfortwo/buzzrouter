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
 * The signer-free "Connect" journey: a phone with NO browser extension pastes an
 * invite link, admits the bridge, and connects to the BuzzRouter community in
 * one step — authorized by the pasted owner/admin invite and the
 * community-scoped session it mints, never a NIP-07 signature or a second
 * proposal/confirmation mechanism.
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
let featuredCommunityId: string;

test.beforeAll(async () => {
  relay = await startFakeRelay([
    { id: "general", name: "general" },
    { id: "builders", name: "builders" },
  ]);
  relay.setRoster([{ pubkey: callerOwner, role: "owner" }]);
  pool = new Pool({ connectionString: databaseUrl });
  await resetDatabase(pool);

  // The BuzzRouter community itself: verified, owned, connector already active.
  // Its relay is never dialed in this spec (no supervisor runs here), so a
  // placeholder wss:// is fine — hub creation only needs the active row.
  featuredCommunityId = await seedOwnedCommunity(pool, {
    canonicalRelayUrl: "wss://relay.buzzrouter.com",
    displayName: "BuzzRouter",
    host: HOME_HOST,
    ownerPubkey: featuredOwner,
  });
  await seedActiveConnection(
    pool,
    featuredCommunityId,
    "wss://relay.buzzrouter.com",
  );

  // The caller's own community: verified + owned, but NOT yet connected — the
  // invite flow admits the bridge. Its relay IS the live fake relay, so the real
  // redeem (HTTP claim) + activate (kind-0 round trip) run against it.
  callerCommunityId = await seedOwnedCommunity(pool, {
    canonicalRelayUrl: relay.url,
    displayName: "Caller Community",
    host: "caller.signerfree.example",
    ownerPubkey: callerOwner,
  });
});

test.afterAll(async () => {
  await pool?.end();
  await relay?.close();
});

test("a phone with no extension connects to BuzzRouter from an invite link", async ({
  page,
}) => {
  test.setTimeout(60_000);
  // The page leads with the signer-free flow — no extension wall gating it.
  await page.goto("/shared-channels");
  await expect(
    page.getByText("Connect one channel to the open BuzzRouter hub."),
  ).toBeVisible();
  const flow = page.getByRole("figure", {
    name: "One connection. Every hub community.",
  });
  await expect(flow).toBeVisible();
  await expect(flow.getByText("Paste invite")).toBeVisible();
  await expect(flow.getByText("Pick channel")).toBeVisible();
  await expect(flow.getByText("Hub opens")).toBeVisible();
  await expect(flow.getByText("Messages fan out")).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(flow.getByText("Invite accepted")).toBeVisible();
  await expect(flow.getByText("Send + receive on ✓")).toBeVisible();
  await expect(
    flow.getByText(
      "Franz · Orange Magic [via BuzzRouter] · Sure, give me a couple of hours",
    ),
  ).toBeVisible();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect(
    page.getByRole("button", { name: "Connect signer" }),
  ).toHaveCount(0);
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

  // The admitted connector lists real channels before the hub can be joined.
  const channelPicker = page.getByRole("combobox", {
    name: "Channel for hub messages",
  });
  await channelPicker.fill("gen");
  await page.getByRole("option", { name: /#general/ }).click();
  await page
    .getByRole("button", { name: "Connect channel to hub" })
    .click();

  await expect(
    page.getByRole("heading", {
      name: "Caller Community is in the open channel",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Send messages to the hub")).toBeChecked();
  await expect(page.getByLabel("Receive messages from the hub")).toBeChecked();

  // The one filter controls both directions, so it remains editable when
  // receiving is off. Selecting only BuzzRouter models a private pair without
  // reviving a proposal or confirmation mechanism.
  await page.getByLabel("Receive messages from the hub").click();
  await expect(page.getByLabel("Receive messages from the hub")).not.toBeChecked();
  await expect(page.getByLabel("Community filter mode")).toBeEnabled();
  await page.getByLabel("Community filter mode").selectOption("only_these");
  await expect(page.getByLabel("Community filter mode")).toHaveValue("only_these");
  await page.getByLabel("BuzzRouter", { exact: true }).click();
  await expect(page.getByLabel("BuzzRouter", { exact: true })).toBeChecked();

  // Hub membership is immediately active. There is no bilateral confirmation.
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
      WHERE channels.mode = 'hub'
      ORDER BY endpoints.role
    `,
  );
  const caller = endpoints.rows.find(
    (row) => row.community_id === callerCommunityId,
  );
  expect(caller).toMatchObject({
    community_id: callerCommunityId,
    local_channel_id: "general",
    role: "participant",
    state: "active",
  });
  const settings = await pool.query<{
    filter_list: string[];
    filter_mode: string;
    receives: boolean;
    sends: boolean;
  }>(
    `
      SELECT endpoints.filter_list, endpoints.filter_mode,
             endpoints.receives, endpoints.sends
      FROM shared_channel_endpoints AS endpoints
      WHERE endpoints.community_id = $1
    `,
    [callerCommunityId],
  );
  expect(settings.rows[0]).toMatchObject({
    filter_list: [featuredCommunityId],
    filter_mode: "only_these",
    receives: false,
    sends: true,
  });

  // The same combobox in settings filters relay-backed channels and changes
  // the endpoint without creating anything.
  await channelPicker.fill("build");
  await page.getByRole("option", { name: /#builders/ }).click();
  await page.getByRole("button", { name: "Change hub channel" }).click();
  await expect(
    page.getByText("#builders", { exact: true }),
  ).toBeVisible();

  // An unmatched name only creates after the owner clicks the explicit action.
  await channelPicker.fill("clover");
  await expect(page.getByRole("button", { name: "Create #clover" }))
    .toBeVisible();
  expect(relay.channels().some((channel) => channel.name === "clover"))
    .toBe(false);
  await page.getByRole("button", { name: "Create #clover" }).click();
  await expect(page.getByText("#clover", { exact: true })).toBeVisible({
    timeout: 15_000,
  });

  const created = relay.channels().find((channel) => channel.name === "clover");
  expect(created).toBeTruthy();
  const connection = await pool.query<{ bridge_pubkey: string }>(
    "SELECT bridge_pubkey FROM community_connections WHERE community_id = $1",
    [callerCommunityId],
  );
  const roster = new Map(
    relay
      .channelMembers(created!.id)
      .map((member) => [member.pubkey, member.role]),
  );
  expect(roster.get(callerOwner)).toBe("owner");
  expect(roster.get(connection.rows[0].bridge_pubkey)).toBe("member");

  const rebound = await pool.query<{
    local_channel_id: string;
    local_channel_name_snapshot: string;
  }>(
    `
      SELECT local_channel_id, local_channel_name_snapshot
      FROM shared_channel_endpoints
      WHERE community_id = $1
    `,
    [callerCommunityId],
  );
  expect(rebound.rows[0]).toMatchObject({
    local_channel_id: created!.id,
    local_channel_name_snapshot: "clover",
  });

  // Regression: after the short-lived session expires, the same valid invite
  // proves control again and returns directly to the existing settings.
  await pool.query(
    "UPDATE connection_owner_sessions SET expires_at = now() - interval '1 minute' WHERE community_id = $1",
    [callerCommunityId],
  );
  await page.reload();
  const reentryInvite = page.getByLabel("Invite link from your Buzz app");
  await reentryInvite.fill(
    `https://127.0.0.1:${invitePort}/invite/reentry-code`,
  );
  await page.getByRole("button", { name: "Add your community" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Caller Community is in the open channel",
    }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("#clover", { exact: true })).toBeVisible();
  await expect(page.getByText(/already connected/i)).toHaveCount(0);

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
      connection_owner_sessions,
      bridge_channel_handoffs,
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
