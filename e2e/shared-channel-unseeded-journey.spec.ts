import { resolve } from "node:path";

// This spec runs a ConnectorSupervisor IN THE TEST PROCESS (the app server does
// not run one), so the runner itself opens the wss:// handshake to the fake
// relay. Trust its self-signed cert here, before any TLS happens — no
// verification is disabled.
process.env.NODE_EXTRA_CA_CERTS = resolve("e2e/fixtures/fake-relay-cert.pem");

import { expect, test } from "@playwright/test";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { PgBoss } from "pg-boss";
import { Pool } from "pg";

import {
  ConnectorSupervisor,
  createFileWrappingKeyProvider,
} from "../src/shared-channels/connector";
import { beginConnectionFromInvite } from "../src/shared-channels/installer";

import { startFakeRelay, type FakeRelay } from "./support/fake-relay";
import { openOwnerSessionWorkspace } from "./support/owner-session";

/**
 * The full new-owner shared-channel journey, driven through the real UI and
 * real API with the ABSOLUTE MINIMUM seeded state.
 *
 * Unlike shared-channel-admin.spec.ts — which seeds owned communities AND
 * active community_connections straight into Postgres and then exercises only
 * the tail — this spec seeds only what community discovery legitimately
 * produces (a `verified_buzz` candidate) and then walks verified-community
 * search → owner invite admission → proposal (relay-backed picker) → accept.
 * No ownership claim or editable directory listing is needed.
 */

interface Owner {
  privateKey: Uint8Array;
  pubkey: string;
}

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

const ownerB = createOwner(2);

let pool: Pool;
// Two relays because candidate relay URLs are UNIQUE and must be wss://host:port
// with no path — the two communities therefore need distinct ports.
let relayA: FakeRelay;
let relayB: FakeRelay;
let communityB: string;
let communityBPrincipal: string;

test.beforeAll(async () => {
  // A single in-process fake relay stands in for both communities' Buzz relays.
  // Its two NIP-29 groups are what the relay-backed channel picker (PR #24)
  // lists. The connector's production connection factory talks to it for real
  // over a WebSocket — only the relay on the far end is a test double.
  const groups = [
    { id: "general", name: "general" },
    { id: "builders", name: "builders" },
  ];
  relayA = await startFakeRelay(groups);
  relayB = await startFakeRelay(groups);

  pool = new Pool({ connectionString: databaseUrl });
  await resetDatabase(pool);

  await seedVerifiedCandidate(
    pool,
    "alpha.unseeded.example",
    relayA.url,
  );
  await seedVerifiedCandidate(
    pool,
    "beta.unseeded.example",
    relayB.url,
  );

  // Community B is admitted through the same invite-link service as A. It must
  // be connected before A can see it as a destination.
  const beta = await beginConnectionFromInvite(
    pool,
    inviteForRelay(relayB),
    createFileWrappingKeyProvider(
      resolve("e2e/fixtures/connector-wrapping-keys.json"),
    ),
  );
  communityB = beta.communityId;
  communityBPrincipal = await communityOwnerPubkey(pool, communityB);

  // Beta's relay-signed roster: owner B is the owner, so a code B types is
  // authorized. A forwarded link grants nothing without this.
  relayB.setRoster([{ pubkey: ownerB.pubkey, role: "owner" }]);
});

test.afterAll(async () => {
  await pool?.end();
  await relayA?.close();
  await relayB?.close();
});

test("a new owner completes the whole shared-channel journey through real UI and API", async ({
  page,
}) => {
  // ── Step 1: find the verified community, then route into the primary
  // invite-link flow instead of an ownership-claim workspace.
  await page.goto("/shared-channels");
  await page
    .getByText("Not sure BuzzRouter knows your community?")
    .click();

  await page
    .getByLabel("Search verified communities")
    .fill("alpha.unseeded.example");
  await page.getByRole("button", { name: "Search" }).click();
  const searchResult = page.getByRole("link", {
    name: "alpha.unseeded.example",
  });
  await expect(searchResult).toHaveAttribute("href", "#invite-link");
  await searchResult.click();
  await expect(
    page.getByText(/Found alpha\.unseeded\.example/),
  ).toBeVisible();

  // ── Step 2: paste an owner invite. The real endpoint enrolls the bare
  // verified candidate, admits the bridge, activates the connector, and mints
  // the scoped session used by the rest of the page.
  await page
    .getByLabel("Invite link from your Buzz app")
    .fill(inviteForRelay(relayA));
  await page.getByRole("button", { name: "Add your community" }).click();
  await expect(
    page.getByRole("heading", { name: "Connected: alpha.unseeded.example" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Bot connected")).toBeVisible();

  // ── Step 3: reach the proposal form and pick a channel from the relay-backed
  // picker (PR #24) rather than typing an id.
  // Creating a fresh channel is the default now; this spec exercises the
  // alternative — binding a channel the community already has — so switch to it.
  await page
    .getByRole("radio", { name: "Use a channel I already have" })
    .click();
  const sourcePicker = page.getByLabel("Local channel", { exact: true });
  // The fake relay never sends a NIP-42 challenge, so the connector's
  // authenticate() now (correctly) waits out its full settle deadline before
  // treating that as no-auth-required, rather than the old instant no-op.
  await expect(sourcePicker).toBeEnabled({ timeout: 10_000 });
  await sourcePicker.selectOption({ label: "general" });
  await page.getByLabel("Shared name").fill("benchmark-review");
  await page
    .getByLabel("Purpose")
    .fill("Review benchmark methodology across both communities.");
  await page.getByLabel("Destination community").selectOption(communityB);

  // ── Step 4: propose to the second community.
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  // ── Step 5: as the second community's owner, arm the acceptance by picking a
  // channel — this only mints a one-time code, it does NOT bind the route.
  await openOwnerSessionWorkspace(page, pool, {
    communityId: communityB,
    displayName: "beta.unseeded.example",
    ownerPubkey: communityBPrincipal,
    relayUrl: relayB.url,
  });
  const route = page
    .locator("article")
    .filter({ hasText: "benchmark-review" });
  await expect(route).toBeVisible();
  await route
    .getByRole("radio", { name: "Use a channel I already have" })
    .click();
  const acceptPicker = route.getByLabel("Local channel", { exact: true });
  await expect(acceptPicker).toBeEnabled({ timeout: 10_000 });
  await acceptPicker.selectOption({ label: "builders" });
  await route.getByRole("button", { name: "Accept" }).click();

  const code = (await route.locator("code").innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  // ── Step 6: authority to bind lives in Beta's roster, not the web click. Run
  // the bridge (the app server does not) and have owner B type the code into the
  // chosen channel; the connector reads Beta's roster, sees B is owner, and only
  // then activates the route.
  const supervisor = new ConnectorSupervisor(
    pool,
    {} as unknown as PgBoss,
    createFileWrappingKeyProvider(
      resolve("e2e/fixtures/connector-wrapping-keys.json"),
    ),
  );
  await supervisor.start();
  try {
    relayB.injectEvent(
      finalizeEvent(
        {
          content: `Confirming BuzzRouter: ${code}`,
          created_at: Math.floor(Date.now() / 1_000),
          kind: 9,
          tags: [["h", "builders"]],
        },
        ownerB.privateKey,
      ),
    );
    await expect(route).toContainText("active", { timeout: 20_000 });
  } finally {
    await supervisor.stop();
  }
});

test("a missing community keeps the owner on the verification path", async ({
  page,
}) => {
  await page.goto("/shared-channels");
  await page
    .getByText("Not sure BuzzRouter knows your community?")
    .click();
  await page
    .getByLabel("Search verified communities")
    .fill("no-such-community-anywhere");
  await page.getByRole("button", { name: "Search" }).click();

  await expect(page.getByRole("link", { name: "Submit it" })).toHaveAttribute(
    "href",
    "/submit",
  );
});

// ── Seeding (the minimum discovery legitimately produces) ────────────────────

async function seedVerifiedCandidate(
  database: Pool,
  host: string,
  relayUrl: string,
): Promise<string> {
  const candidate = await database.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [relayUrl, host],
  );
  return candidate.rows[0].id;
}

async function communityOwnerPubkey(
  database: Pool,
  communityId: string,
): Promise<string> {
  const result = await database.query<{ owner_pubkey: string }>(
    "SELECT owner_pubkey FROM communities WHERE id = $1",
    [communityId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Community owner principal was not enrolled.");
  }
  return row.owner_pubkey;
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

// ── Misc ─────────────────────────────────────────────────────────────────────

function createOwner(marker: number): Owner {
  const privateKey = new Uint8Array(32);
  privateKey[31] = marker;
  return { privateKey, pubkey: getPublicKey(privateKey) };
}

function inviteForRelay(relay: FakeRelay): string {
  const port = new URL(relay.url).port;
  return `https://127.0.0.1:${port}/invite/unseeded-owner-code`;
}
