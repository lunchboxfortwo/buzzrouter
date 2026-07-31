import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";

// This spec runs a ConnectorSupervisor IN THE TEST PROCESS (the app server does
// not run one), so the runner itself opens the wss:// handshake to the fake
// relay. Trust its self-signed cert here, before any TLS happens — no
// verification is disabled.
process.env.NODE_EXTRA_CA_CERTS = resolve("e2e/fixtures/fake-relay-cert.pem");

import { expect, test } from "@playwright/test";
import type { EventTemplate } from "nostr-tools/core";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import type { PgBoss } from "pg-boss";
import { Pool } from "pg";

import {
  beginChallengeAttempt,
  completeClaimChallenge,
  createClaimChallenge,
} from "../src/claims/store";
import {
  ConnectorSupervisor,
  createFileWrappingKeyProvider,
} from "../src/shared-channels/connector";

import { startFakeRelay, type FakeRelay } from "./support/fake-relay";

/**
 * The full new-owner shared-channel journey, driven through the real UI and
 * real API with the ABSOLUTE MINIMUM seeded state.
 *
 * Unlike shared-channel-admin.spec.ts — which seeds claimed communities AND
 * active community_connections straight into Postgres and then exercises only
 * the tail — this spec seeds only what community discovery legitimately
 * produces (a `verified_buzz` candidate plus its fresh probe snapshot) and then
 * walks claim → publish → connector activation → proposal (relay-backed picker)
 * → accept, so claiming, connector installation, and the invitation handoff all
 * get real browser + API coverage.
 *
 * The ONE thing not exercised end to end is the claim-proof network round trip
 * (DNS TXT / HTTPS file / hosted NIP-11 icon). See `finishClaimSkippingProof`
 * for exactly what is skipped and why it cannot run honestly in CI.
 */

interface Owner {
  privateKey: Uint8Array;
  pubkey: string;
}

const BASE_URL = "http://127.0.0.1:3210";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required.");
}

const ownerA = createOwner(1);
const ownerB = createOwner(2);

let pool: Pool;
// Two relays because candidate relay URLs are UNIQUE and must be wss://host:port
// with no path — the two communities therefore need distinct ports.
let relayA: FakeRelay;
let relayB: FakeRelay;
let candidateA: string;
let candidateB: string;
let communityB: string;

// The signer the injected window.nostr answers as; flipped between owners
// mid-test the same way shared-channel-admin.spec.ts does.
let activeSigner: Owner = ownerA;

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

  candidateA = await seedVerifiedCandidate(
    pool,
    "alpha.unseeded.example",
    relayA.url,
  );
  candidateB = await seedVerifiedCandidate(
    pool,
    "beta.unseeded.example",
    relayB.url,
  );

  // Community B is the counterparty that receives and accepts A's invitation.
  // It is set up through the REAL API surface — the only bypass is the same
  // documented claim-proof hop A also can't run in CI. B must be fully live
  // (published, open to shared channels, connector active) before A can even
  // see it as a destination, because getSharedChannelAdminWorkspace only lists
  // destinations whose connector state is 'active'.
  const challengeB = await createClaimChallenge(
    pool,
    candidateB,
    ownerB.pubkey,
    "dns_txt",
    createTokenHash(randomBytes(32).toString("base64url")),
  );
  await finishClaimSkippingProof(pool, challengeB.challengeId, ownerB);
  communityB = await communityIdForCandidate(pool, candidateB);
  await publishListing(ownerB, candidateB, {
    displayName: "Beta Community",
    slug: "beta-community",
  });
  await activateConnector(ownerB, communityB);

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
  await installSigner(page);

  // ── Step 1: land on /shared-channels owning nothing → claim-lookup empty
  // state (PR #23) → /claim/<candidateId>.
  activeSigner = ownerA;
  await page.goto("/shared-channels");
  await page.getByRole("button", { name: "Connect signer" }).click();
  await expect(page.getByText("No owned communities")).toBeVisible();

  await page
    .getByLabel("Search communities to claim")
    .fill("alpha.unseeded.example");
  await page.getByRole("button", { name: "Search" }).click();
  const claimLink = page.getByRole("link", { name: "alpha.unseeded.example" });
  await expect(claimLink).toHaveAttribute("href", `/claim/${candidateA}`);
  await claimLink.click();
  await expect(page).toHaveURL(`/claim/${candidateA}`);
  await expect(page.getByText("Community ownership")).toBeVisible();

  // ── Step 2: complete the claim as owner A, then publish the listing.
  await page.getByRole("button", { name: "Connect Nostr signer" }).click();
  await expect(page.locator("code", { hasText: ownerA.pubkey })).toBeVisible();
  await page.getByRole("button", { name: "Create proof challenge" }).click();
  await expect(page.getByText("Proof instructions are ready.")).toBeVisible();

  // GAP (documented, not silently seeded): the proof "Check proof" step would
  // fetch a DNS TXT record / HTTPS .well-known file / hosted NIP-11 icon from
  // the candidate's real public host over TLS. That cannot run in CI without
  // either controlling a real public domain or weakening a production SSRF
  // control (resolvePublicAddresses rejects loopback/private IPs, and the proof
  // fetchers require valid TLS). So instead of faking the verifier on the live
  // route, we run the EXACT production code the verify route runs AFTER proof
  // succeeds — beginChallengeAttempt + completeClaimChallenge against the real
  // challenge the UI just created — skipping ONLY verifyClaimProof. Everything
  // else in the claim (challenge state machine, community creation, ownership
  // assignment) is real.
  const challengeA = await pendingChallengeId(pool, candidateA, ownerA);
  await finishClaimSkippingProof(pool, challengeA, ownerA);

  // Reload so the server component re-reads ownership and unlocks the listing
  // form, then publish through the real form + real PUT /api/communities.
  await page.reload();
  await page.getByRole("button", { name: "Connect Nostr signer" }).click();
  await page.getByLabel("Display name").fill("Alpha Community");
  await page.getByLabel("URL slug").fill("alpha-community");
  await page
    .getByLabel("Description")
    .fill("First community driving the shared-channel journey end to end.");
  await page.getByLabel("Categories").fill("research");
  const openToShared = page.getByRole("checkbox");
  if (!(await openToShared.isChecked())) {
    await openToShared.check();
  }
  await page.getByLabel("Visibility").selectOption("public");
  await page.getByRole("button", { name: "Save listing" }).click();
  await expect(
    page.getByText("Published at /communities/alpha-community"),
  ).toBeVisible();

  // ── Step 3: admit the bridge / activate the connector.
  await page.goto("/shared-channels");
  await page.getByRole("button", { name: "Connect signer" }).click();
  await expect(page.getByText("Bot not added yet")).toBeVisible();
  await page.getByRole("button", { name: "Add the bot", exact: true }).click();

  // The self-host connector command (demoted behind a disclosure) still carries
  // the single-use token. We act as the connector CLI would: POST it to the
  // REAL activate endpoint, which runs the production relay round trip (publish
  // + hasEvent) against the fake relay. The bot-admission page now ALSO polls
  // this same endpoint itself, so the token may already be consumed by the time
  // our explicit call lands — both hit the same production activation, so we
  // accept either a fresh success or an already-consumed token.
  await page
    .getByText("Run your own relay? Use the connector command")
    .click();
  const command = await page
    .locator("code", { hasText: "--router" })
    .innerText();
  const token = parseInstallToken(command);
  const activation = await page.request.post(
    "/api/community-connections/activate",
    { data: { token } },
  );
  expect([200, 409]).toContain(activation.status());

  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Bot connected")).toBeVisible();

  // ── Step 4: reach the proposal form and pick a channel from the relay-backed
  // picker (PR #24) rather than typing an id.
  const sourcePicker = page.getByLabel("Local channel", { exact: true });
  await expect(sourcePicker).toBeEnabled();
  await sourcePicker.selectOption({ label: "general" });
  await page.getByLabel("Shared name").fill("benchmark-review");
  await page
    .getByLabel("Purpose")
    .fill("Review benchmark methodology across both communities.");
  await page.getByLabel("Destination community").selectOption(communityB);

  // ── Step 5: propose to the second community.
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  // ── Step 6: as the second community's owner, arm the acceptance by picking a
  // channel — this only mints a one-time code, it does NOT bind the route.
  activeSigner = ownerB;
  await page.goto("/shared-channels");
  await page.getByRole("button", { name: "Connect signer" }).click();
  const route = page
    .locator("article")
    .filter({ hasText: "benchmark-review" });
  await expect(route).toBeVisible();
  const acceptPicker = route.getByLabel("Local channel", { exact: true });
  await expect(acceptPicker).toBeEnabled();
  await acceptPicker.selectOption({ label: "builders" });
  await route.getByRole("button", { name: "Accept" }).click();

  const code = (await route.locator("code").innerText()).trim();
  expect(code).toMatch(/^[A-Z2-9]{8}$/);

  // ── Step 7: authority to bind lives in Beta's roster, not the web click. Run
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

// ── Signer injection ───────────────────────────────────────────────────────

async function installSigner(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.exposeFunction("__testGetPublicKey", () => activeSigner.pubkey);
  await page.exposeFunction("__testSignEvent", (template: EventTemplate) =>
    finalizeEvent(template, activeSigner.privateKey),
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

// ── Claim helpers ────────────────────────────────────────────────────────────

/**
 * Runs the exact production completion the verify route runs once proof passes
 * — the ONLY step skipped is verifyClaimProof (the un-CI-able network hop). It
 * never touches a live request path, so production proof verification is not
 * weakened.
 */
async function finishClaimSkippingProof(
  database: Pool,
  challengeId: string,
  owner: Owner,
): Promise<void> {
  const record = await beginChallengeAttempt(
    database,
    challengeId,
    owner.pubkey,
  );
  await completeClaimChallenge(database, record);
}

async function pendingChallengeId(
  database: Pool,
  candidateId: string,
  owner: Owner,
): Promise<string> {
  const result = await database.query<{ id: string }>(
    `
      SELECT id
      FROM claim_challenges
      WHERE candidate_id = $1
        AND claimant_pubkey = $2
        AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [candidateId, owner.pubkey],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("No pending claim challenge was found for the candidate.");
  }
  return row.id;
}

// ── Signed API helpers (mirror the browser client's NIP-98 auth) ─────────────

async function publishListing(
  owner: Owner,
  candidateId: string,
  input: { displayName: string; slug: string },
): Promise<void> {
  const response = await signedFetch(
    owner,
    `/api/communities/${candidateId}`,
    "PUT",
    {
      categories: ["research"],
      description: "Counterparty community for the shared-channel journey.",
      displayName: input.displayName,
      joinMode: "invite_required",
      joinUrl: null,
      openToSharedChannels: true,
      slug: input.slug,
      visibility: "public",
    },
  );
  await assertOk(response, "publish listing");
}

async function activateConnector(
  owner: Owner,
  communityId: string,
): Promise<void> {
  const tokenResponse = await signedFetch(
    owner,
    "/api/community-connections/install-token",
    "POST",
    { communityId },
  );
  const { command } = (await assertOk(tokenResponse, "install token")) as {
    command: string;
  };
  const token = parseInstallToken(command);

  const activation = await fetch(
    new URL("/api/community-connections/activate", BASE_URL),
    {
      body: JSON.stringify({ token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
  await assertOk(activation, "activate connector");
}

async function signedFetch(
  owner: Owner,
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown,
): Promise<Response> {
  const url = new URL(path, BASE_URL).toString();
  const rawBody = method === "GET" ? undefined : JSON.stringify(body ?? {});
  const tags: string[][] = [
    ["u", url],
    ["method", method],
    ["nonce", randomBytes(16).toString("hex")],
  ];
  if (rawBody !== undefined) {
    tags.push(["payload", createHash("sha256").update(rawBody).digest("hex")]);
  }
  const event = finalizeEvent(
    {
      content: "",
      created_at: Math.floor(Date.now() / 1_000),
      kind: 27_235,
      tags,
    },
    owner.privateKey,
  );
  const authorization = Buffer.from(JSON.stringify(event)).toString("base64");

  return fetch(url, {
    body: rawBody,
    headers: {
      authorization: `Nostr ${authorization}`,
      ...(rawBody === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    method,
  });
}

async function assertOk(
  response: Response,
  label: string,
): Promise<unknown> {
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) {
    throw new Error(
      `Failed to ${label}: ${response.status} ${payload.error ?? ""}`.trim(),
    );
  }
  return payload;
}

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
  const candidateId = candidate.rows[0].id;
  // A fresh, successful probe is part of what discovery produces for a verified
  // candidate; both claim-challenge creation and listing publication require it.
  await database.query(
    `
      INSERT INTO probe_snapshots (candidate_id, tls_valid, result_code)
      VALUES ($1, true, 'exact_software_and_protocol')
    `,
    [candidateId],
  );
  return candidateId;
}

async function communityIdForCandidate(
  database: Pool,
  candidateId: string,
): Promise<string> {
  const result = await database.query<{ id: string }>(
    "SELECT id FROM communities WHERE candidate_id = $1",
    [candidateId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error("Community row was not created for the candidate.");
  }
  return row.id;
}

async function resetDatabase(database: Pool): Promise<void> {
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
}

// ── Misc ─────────────────────────────────────────────────────────────────────

function createOwner(marker: number): Owner {
  const privateKey = new Uint8Array(32);
  privateKey[31] = marker;
  return { privateKey, pubkey: getPublicKey(privateKey) };
}

function createTokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function parseInstallToken(command: string): string {
  const match = /buzzrouter-connect\s+([A-Za-z0-9_-]{43})\s+--router/.exec(
    command,
  );
  if (!match) {
    throw new Error(`Could not parse install token from command: ${command}`);
  }
  return match[1];
}
