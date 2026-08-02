import { expect, test } from "@playwright/test";
import { decode } from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";
import { Pool } from "pg";

import { openOwnerSessionWorkspace } from "./support/owner-session";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

const privateKey = new Uint8Array(32);
privateKey[31] = 40;
const ownerPubkey = getPublicKey(privateKey);
const relayUrl = "wss://bot.e2e.example";
let pool: Pool;
let communityId = "";

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
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [relayUrl, "bot.e2e.example"],
  );
  const community = await pool.query<{ id: string }>(
    `
      INSERT INTO communities (
        candidate_id, slug, visibility, claim_state, owner_pubkey,
        display_name, description, categories, listed_at, open_to_shared_channels
      )
      VALUES (
        $1, 'e2e-bot', 'public', 'admin_verified', $2,
        'E2E bot', 'Deterministic bot-admission community',
        ARRAY['research'], now(), true
      )
      RETURNING id
    `,
    [candidate.rows[0].id, ownerPubkey],
  );
  communityId = community.rows[0].id;
});

test.afterAll(async () => {
  await pool?.end();
});

test("an owner admits the bot with a pasted key rendered as an npub", async ({
  page,
}) => {
  await openOwnerSessionWorkspace(page, pool, {
    communityId,
    displayName: "E2E bot",
    ownerPubkey,
    relayUrl,
  });
  await expect(page.getByLabel("Community", { exact: true })).toHaveValue(
    communityId,
  );

  // The connection status leads with the bot, not a connector.
  await page.getByRole("button", { name: "Add the bot", exact: true }).click();

  // The invite-link path is primary and always visible; the self-host command
  // is present but demoted behind a disclosure (the e2e server configures a
  // connector package spec, so the command renders).
  await expect(page.getByLabel("Buzz invite link")).toBeVisible();
  await expect(
    page.getByText("Run your own relay? Use the connector command"),
  ).toBeVisible();

  // The bridge key is rendered as a bech32 npub, never raw hex.
  await page.getByText("Prefer to add a member by key?").click();
  const key = page.locator("code", { hasText: /^npub1/ });
  await expect(key).toBeVisible();
  const rendered = (await key.textContent())?.trim() ?? "";
  expect(rendered.startsWith("npub1")).toBe(true);
  const decoded = decode(rendered);
  expect(decoded.type).toBe("npub");
  expect(typeof decoded.data).toBe("string");
  expect((decoded.data as string).length).toBe(64);

  // Redeeming a link for a different relay is refused before any network call,
  // exercising the redeem button -> endpoint -> plain-language error wiring.
  await page
    .getByLabel("Buzz invite link")
    .fill("https://evil.example/invite/abc");
  await page
    .getByRole("button", { name: "Add the bot with this link" })
    .click();
  await expect(
    page.getByText(/different relay than this community/),
  ).toBeVisible();
});
