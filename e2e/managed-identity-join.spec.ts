// The managed-identity click-to-join journey, end to end through the REAL app
// routes: a visitor with no key starts in Discover, opens one community's
// consent page, accepts its real policy, and chooses the keyless join option.
// BuzzRouter then mints + holds a Nostr key and claims the invite with the fresh
// policy receipt. Then the visitor exports the key.
//
// Only the community relay is a fake (in-process HTTPS server the app already
// trusts via NODE_EXTRA_CA_CERTS). Identity creation, the encrypted-at-rest
// keypair, the NIP-98-signed claim, the session cookie, and the nsec export all
// run through the production code path with the fixture wrapping key configured
// in playwright.config.ts.
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

import { startFakeRelay, type FakeRelay } from "./support/fake-relay";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

let pool: Pool;
let relay: FakeRelay;
let relayHost: string;

test.beforeAll(async () => {
  relay = await startFakeRelay([{ id: "general", name: "general" }], {
    joinPolicy: {
      ageAttestationRequired: true,
      privacyMarkdown: "KEYLESS E2E PRIVACY NOTICE",
      receipt: "keyless-e2e-receipt",
      termsMarkdown: "KEYLESS E2E TERMS",
      version: "keyless-e2e-v1",
    },
  });
  relayHost = relay.url.slice("wss://".length);
  pool = new Pool({ connectionString: databaseUrl });
  await resetDatabase(pool);
  await seedJoinableCommunity(pool, {
    canonicalRelayUrl: relay.url,
    displayName: "Test Joinable Community",
    host: relayHost,
    inviteCode: "e2e-invite-code",
  });
});

test.afterAll(async () => {
  await pool.end();
  await relay.close();
});

test("a keyless visitor joins a community and can export the managed key", async ({
  page,
}) => {
  await page.goto("/");

  // Single-word nav, one level: adding a tab or a qualifier here is a
  // regression, not a copy tweak.
  await expect(page.getByRole("navigation").getByRole("link")).toHaveText([
    "Discover",
    "Create",
    "Link",
    "List",
  ]);
  const [joinPage] = await Promise.all([
    page.context().waitForEvent("page"),
    page.getByRole("button", { name: "Join Test Joinable Community" }).click(),
  ]);
  await joinPage.waitForLoadState("domcontentloaded");

  // Custody is disclosed up front, not buried.
  await expect(
    joinPage.getByRole("heading", { name: "BuzzRouter holds your key" }),
  ).toBeVisible();
  await expect(joinPage.getByText(/encrypted on our servers/i)).toBeVisible();

  // The same real consent gate controls both Buzz and keyless entry.
  const consent = joinPage.getByRole("checkbox");
  await expect(consent).not.toBeChecked();
  const join = joinPage.getByRole("button", { name: "Join without Buzz" });
  await expect(join).toBeDisabled();
  await consent.check();
  await expect(join).toBeEnabled();
  await join.click();

  // The relay rejects bare claims in this fixture, so Joined proves the fresh
  // receipt travelled through the managed-identity claim.
  await expect(joinPage.getByRole("button", { name: "Joined" })).toBeVisible({
    timeout: 15_000,
  });

  // The durable session cookie is set (HttpOnly), so the identity persists.
  const cookies = await joinPage.context().cookies();
  const sessionCookie = cookies.find((c) => c.name === "br_identity");
  expect(sessionCookie?.httpOnly).toBe(true);

  // The identity now shows in the custody panel.
  await expect(joinPage.locator("code", { hasText: /^npub1/ })).toBeVisible();

  // Export reveals the nsec exactly once, with a plain custody warning.
  await joinPage.getByRole("button", { name: "Export my key" }).click();
  const dialog = joinPage.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/exists outside BuzzRouter's custody/i)).toBeVisible();
  const nsecBoxes = dialog.locator("code", { hasText: /^nsec1/ });
  await expect(nsecBoxes).toHaveCount(1);
  await expect(joinPage.getByRole("button", { name: "Copy nsec" })).toBeVisible();

  // Dismissing hides the secret; the custody panel now flags the export.
  await dialog.getByRole("button", { name: "I've saved it" }).click();
  await expect(dialog).toBeHidden();
  await expect(
    joinPage.getByText(/a copy exists outside our custody/i),
  ).toBeVisible();
});

async function seedJoinableCommunity(
  database: Pool,
  input: {
    canonicalRelayUrl: string;
    displayName: string;
    host: string;
    inviteCode: string;
  },
): Promise<void> {
  const candidate = await database.query<{ id: string }>(
    `
      INSERT INTO community_candidates (canonical_relay_url, host, state)
      VALUES ($1, $2, 'verified_buzz')
      RETURNING id
    `,
    [input.canonicalRelayUrl, input.host],
  );
  const candidateId = candidate.rows[0].id;

  // A fresh successful probe, required for the directory to surface the row.
  await database.query(
    `
      INSERT INTO probe_snapshots (
        candidate_id, probed_at, tls_valid, result_code,
        software_version, relay_name, supported_nips
      )
      VALUES ($1, now(), true, 'exact_software_and_protocol', '0.9.0', 'buzz', '[11,29,42]'::jsonb)
    `,
    [candidateId],
  );

  // A catalog source carrying the display name AND the invite code, which is
  // what makes the community joinable via the managed identity.
  await database.query(
    `
      INSERT INTO community_sources (
        candidate_id, source_type, source_locator, evidence_hash,
        source_display_name, source_description, source_invite_code
      )
      VALUES ($1, 'buzzdir', $2, $3, $4, $5, $6)
    `,
    [
      candidateId,
      `https://${input.host}/`,
      `hash-${input.host}`,
      input.displayName,
      "A community for the managed-identity e2e.",
      input.inviteCode,
    ],
  );
}

async function resetDatabase(database: Pool): Promise<void> {
  await database.query(`
    TRUNCATE
      managed_identity_memberships,
      managed_identity_sessions,
      managed_identities,
      community_sources,
      probe_snapshots,
      communities,
      community_candidates
    CASCADE
  `);
}
