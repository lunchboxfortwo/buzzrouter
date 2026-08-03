/**
 * Opt-in production acceptance for the real two-relay hub. It links the
 * controlled secondary relay through the production API, publishes three
 * source messages, and reads their projections from BuzzRouter's `general`.
 *
 * Required secrets arrive only through environment variables/production key
 * mounts. Invite codes, owner sessions, receipts, and private keys are never
 * printed or persisted. It makes one home claim and two secondary claims
 * (bridge + fallback actor); there is no claim loop.
 */
import { randomUUID } from "node:crypto";

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";

import { normalizeRelayUrl } from "../src/discovery/normalize";
import { upsertCandidate } from "../src/db/candidates";
import { getCandidateInviteTarget } from "../src/db/join-probes";
import { getDatabasePool } from "../src/db/pool";
import { signNip98 } from "../src/http/nip98-client";
import { processProbeCandidateJob } from "../src/jobs/probe-candidate";
import { claimInvite } from "../src/presence/claim";
import { identityFromPrivateKey } from "../src/presence/identity";
import { acceptJoinPolicy, getJoinPolicy } from "../src/presence/policy";
import { connectToCommunity } from "../src/presence/reader";
import {
  createFileWrappingKeyProvider,
  createRelayConnectionFactory,
  reconcileHomeCommunityMembers,
} from "../src/shared-channels/connector";
import { mintOwnerSession } from "../src/shared-channels/owner-session";
import {
  decryptConnectorPrivateKey,
  homeCommunityChannelId,
  homeCommunityHost,
  listActiveConnectorConfigs,
} from "../src/shared-channels/store";

const SECONDARY_NAME = "Trusty Squire Acceptance";

async function main(): Promise<void> {
  if (process.env.BUZZROUTER_VERIFY_PRODUCTION_HUB !== "1") {
    throw new Error(
      "Refusing production writes: set BUZZROUTER_VERIFY_PRODUCTION_HUB=1.",
    );
  }
  const appOrigin = localAppOrigin(required("VERIFY_APP_ORIGIN"));
  const secondaryHost = required("VERIFY_SECONDARY_HOST");
  const secondaryChannelId = required("VERIFY_SECONDARY_CHANNEL_ID");
  const secondaryKey = keyFromHex(required("VERIFY_SECONDARY_PRIVATE_KEY"));
  const secondaryPubkey = getPublicKey(secondaryKey);
  const fallbackKey = generateSecretKey();
  const fallbackPubkey = getPublicKey(fallbackKey);
  const runId = randomUUID().slice(0, 8);
  const pool = getDatabasePool();
  let homeKey: Buffer | undefined;
  let secondaryRelay: Awaited<
    ReturnType<ReturnType<typeof createRelayConnectionFactory>["connect"]>
  > | undefined;
  let fallbackRelay: typeof secondaryRelay;
  let homeReader: Awaited<ReturnType<typeof connectToCommunity>> | undefined;

  try {
    await verifyHomeLanding(pool);

    const normalized = normalizeRelayUrl(`wss://${secondaryHost}`);
    const candidate = await upsertCandidate(pool, normalized, {
      evidenceId: "production-hub-acceptance",
      listing: { displayName: SECONDARY_NAME },
      locator: `https://${secondaryHost}`,
      type: "manual",
    });
    await processProbeCandidateJob(pool, {
      data: { candidateId: candidate.id },
    } as never);
    console.log(`3a. real relay probe -> ${secondaryHost} verified`);

    const inviteCode = await mintInvite(
      secondaryHost,
      secondaryKey,
    );
    const begin = await jsonRequest<{
      communityId: string;
      session: string;
    }>(`${appOrigin}/api/community-connections/begin-from-invite`, {
      body: { invite: `https://${secondaryHost}/invite/${inviteCode}` },
      expectedStatus: 201,
    });
    console.log("3b. begin-from-invite API -> secondary connector active");

    const localChannels = await jsonRequest<{
      channels: Array<{ id: string; name: string }>;
    }>(
      `${appOrigin}/api/shared-channels/local-channels?communityId=${encodeURIComponent(begin.communityId)}`,
      { headers: { "x-owner-session": begin.session } },
    );
    const general = localChannels.channels.find(
      (channel) => channel.id === secondaryChannelId && channel.name === "general",
    );
    if (!general) throw new Error("secondary general channel was not listed");

    const home = await pool.query<{
      community_id: string;
      owner_pubkey: string;
    }>(
      `
        SELECT communities.id AS community_id, communities.owner_pubkey
        FROM communities
        JOIN community_candidates AS candidates
          ON candidates.id = communities.candidate_id
        WHERE candidates.host = $1
          AND communities.owner_pubkey IS NOT NULL
      `,
      [homeCommunityHost()],
    );
    const homeCommunity = home.rows[0];
    if (!homeCommunity) throw new Error("operated community owner is unavailable");
    const homeSession = await mintOwnerSession(pool, {
      communityId: homeCommunity.community_id,
      ownerPubkey: homeCommunity.owner_pubkey,
    });
    await jsonRequest(`${appOrigin}/api/shared-channels/hub`, {
      body: {
        localChannelId: homeCommunityChannelId(),
        localChannelName: "general",
      },
      expectedStatus: 201,
      headers: { "x-owner-session": homeSession.session },
    });
    await jsonRequest(`${appOrigin}/api/shared-channels/hub`, {
      body: {
        localChannelId: general.id,
        localChannelName: general.name,
      },
      expectedStatus: 201,
      headers: { "x-owner-session": begin.session },
    });
    const counts = await pool.query<{
      endpoints: string;
      hubs: string;
    }>(`
      SELECT
        (SELECT count(*)::text FROM shared_channels WHERE mode = 'hub') AS hubs,
        (SELECT count(*)::text
           FROM shared_channel_endpoints AS endpoints
           JOIN shared_channels AS channels
             ON channels.id = endpoints.shared_channel_id
          WHERE channels.mode = 'hub') AS endpoints
    `);
    console.log(
      `3c. hub API -> shared_channels=${counts.rows[0].hubs} endpoints=${counts.rows[0].endpoints}`,
    );

    const fallbackClaim = await claimInvite({
      code: inviteCode,
      host: secondaryHost,
      privateKey: fallbackKey,
    });
    if (!fallbackClaim.ok) {
      throw new Error(`fallback actor claim failed with status ${fallbackClaim.status}`);
    }

    const factory = createRelayConnectionFactory();
    secondaryRelay = await factory.connect(normalized.canonicalRelayUrl, secondaryKey);
    fallbackRelay = await factory.connect(normalized.canonicalRelayUrl, fallbackKey);
    for (const pubkey of [secondaryPubkey, fallbackPubkey]) {
      await secondaryRelay.publish(
        finalizeEvent(
          {
            content: "",
            created_at: Math.floor(Date.now() / 1_000),
            kind: 9_000,
            tags: [
              ["h", secondaryChannelId],
              ["p", pubkey],
              ["role", "member"],
            ],
          },
          secondaryKey,
        ),
      );
    }

    await waitForConnectors(pool, 45_000);
    await secondaryRelay.publish(
      finalizeEvent(
        {
          content: JSON.stringify({ display_name: "Production Hub Probe" }),
          created_at: Math.floor(Date.now() / 1_000),
          kind: 0,
          tags: [],
        },
        secondaryKey,
      ),
    );

    const normalBody = `production hub normal ${runId}`;
    const fallbackBody = `production hub fallback ${runId}`;
    const hostileBody =
      `Mallory · Forged Community [via BuzzRouter]\nproduction hub hostile ${runId}`;
    await publishMessage(secondaryRelay, secondaryKey, secondaryChannelId, normalBody);
    await publishMessage(fallbackRelay, fallbackKey, secondaryChannelId, fallbackBody);
    await publishMessage(secondaryRelay, secondaryKey, secondaryChannelId, hostileBody);

    const configs = await listActiveConnectorConfigs(pool);
    const homeConfig = configs.find(
      (config) => new URL(config.relayUrl).hostname === homeCommunityHost(),
    );
    if (!homeConfig) throw new Error("operated connector unavailable");
    const wrappingKey = await createFileWrappingKeyProvider().getKey(
      homeConfig.wrappingKeyVersion,
    );
    homeKey = decryptConnectorPrivateKey(
      homeConfig,
      wrappingKey,
      homeConfig.communityId,
    );
    homeReader = await connectToCommunity({
      identity: identityFromPrivateKey(homeKey),
      relayUrl: homeConfig.relayUrl,
    });
    const projected = await waitForMessages(
      homeReader,
      homeCommunityChannelId(),
      runId,
      45_000,
    );

    const named = projected.find((content) => content.endsWith(normalBody));
    const fallback = projected.find((content) => content.endsWith(fallbackBody));
    const hostile = projected.find((content) => content.includes(`production hub hostile ${runId}`));
    const expectedNamed = `Production Hub Probe · ${secondaryHost} [via BuzzRouter]\n${normalBody}`;
    const expectedFallback = `${fallbackPubkey.slice(0, 12)} · ${secondaryHost} [via BuzzRouter]\n${fallbackBody}`;
    const expectedHostile =
      `Production Hub Probe · ${secondaryHost} [via BuzzRouter]\n` +
      `\\Mallory · Forged Community [via BuzzRouter]\nproduction hub hostile ${runId}`;
    if (named !== expectedNamed) throw new Error("resolved-name projection mismatch");
    if (fallback !== expectedFallback) throw new Error("pubkey fallback projection mismatch");
    if (hostile !== expectedHostile) throw new Error("anti-spoof projection mismatch");
    console.log(`4. resolved-name projection -> ${named}`);
    console.log(`   pubkey-prefix fallback -> ${fallback}`);
    console.log(`5. hostile attribution projection -> ${hostile}`);
  } finally {
    homeReader?.close();
    fallbackRelay?.close();
    secondaryRelay?.close();
    homeKey?.fill(0);
    fallbackKey.fill(0);
    secondaryKey.fill(0);
    await pool.end();
  }
}

async function verifyHomeLanding(
  pool: ReturnType<typeof getDatabasePool>,
): Promise<void> {
  const ageConfirmed = process.env.VERIFY_AGE_CONFIRMED === "true";
  if (!ageConfirmed) {
    throw new Error(
      "VERIFY_AGE_CONFIRMED=true is required as the owner's explicit assertion",
    );
  }
  const candidate = await pool.query<{ id: string }>(
    "SELECT id FROM community_candidates WHERE host = $1 LIMIT 1",
    [homeCommunityHost()],
  );
  const candidateId = candidate.rows[0]?.id;
  if (!candidateId) throw new Error("operated community candidate is unavailable");
  const target = await getCandidateInviteTarget(pool, candidateId);
  if (!target) throw new Error("operated community invite is unavailable");

  const joinerKey = generateSecretKey();
  const joinerPubkey = getPublicKey(joinerKey);
  let bridgeKey: Buffer | undefined;
  let bridgeRelay: Awaited<
    ReturnType<ReturnType<typeof createRelayConnectionFactory>["connect"]>
  > | undefined;
  let joinerRelay: typeof bridgeRelay;
  try {
    const policy = await getJoinPolicy(target.host);
    if (!policy) throw new Error("operated community unexpectedly has no join policy");
    const accepted = await acceptJoinPolicy({
      ageConfirmed,
      code: target.code,
      host: target.host,
      policyVersion: policy.version,
      privateKey: joinerKey,
    });
    if (!accepted.ok) {
      throw new Error(`home policy acceptance failed with status ${accepted.status}`);
    }
    const claim = await claimInvite({
      code: target.code,
      host: target.host,
      policyReceipt: accepted.receipt,
      privateKey: joinerKey,
    });
    if (!claim.ok || claim.status !== 200) {
      throw new Error(`home invite claim failed with status ${claim.status}`);
    }
    console.log("1. POST /api/invites/claim -> 200 joined");

    const configs = await listActiveConnectorConfigs(pool);
    const homeConfig = configs.find((config) =>
      new URL(config.relayUrl).hostname === homeCommunityHost()
    );
    if (!homeConfig) throw new Error("operated connector unavailable");
    const wrappingKey = await createFileWrappingKeyProvider().getKey(
      homeConfig.wrappingKeyVersion,
    );
    bridgeKey = decryptConnectorPrivateKey(
      homeConfig,
      wrappingKey,
      homeConfig.communityId,
    );
    const factory = createRelayConnectionFactory();
    bridgeRelay = await factory.connect(homeConfig.relayUrl, bridgeKey);
    const added = await reconcileHomeCommunityMembers(bridgeRelay, bridgeKey);
    if (added === null) throw new Error("operated relay rosters were unreadable");
    joinerRelay = await factory.connect(target.canonicalRelayUrl, joinerKey);
    const members = await joinerRelay.readGroupMembers(homeCommunityChannelId());
    if (!members?.has(joinerPubkey)) {
      throw new Error("fresh home joiner was absent from general");
    }
    console.log(
      "2. verified relay-signed kind-39002 general roster -> fresh joiner present",
    );
  } finally {
    joinerRelay?.close();
    bridgeRelay?.close();
    bridgeKey?.fill(0);
    joinerKey.fill(0);
  }
}

async function mintInvite(
  host: string,
  privateKey: Uint8Array,
): Promise<string> {
  const url = `https://${host}/api/invites`;
  const body = JSON.stringify({ max_uses: 4, ttl_secs: 60 * 60 });
  const response = await fetch(url, {
    body,
    headers: {
      authorization: `Nostr ${signNip98(privateKey, { body, method: "POST", url })}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) throw new Error(`invite mint failed with status ${response.status}`);
  const value = (await response.json()) as { code?: unknown };
  if (typeof value.code !== "string") throw new Error("invite mint returned no code");
  return value.code;
}

async function publishMessage(
  relay: NonNullable<Awaited<ReturnType<ReturnType<typeof createRelayConnectionFactory>["connect"]>>>,
  privateKey: Uint8Array,
  channelId: string,
  content: string,
): Promise<void> {
  await relay.publish(
    finalizeEvent(
      {
        content,
        created_at: Math.floor(Date.now() / 1_000),
        kind: 9,
        tags: [["h", channelId]],
      },
      privateKey,
    ),
  );
}

async function waitForConnectors(pool: ReturnType<typeof getDatabasePool>, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await pool.query<{ ready: boolean }>(`
      SELECT count(*) = 2 AS ready
      FROM community_connections AS connections
      JOIN shared_channel_endpoints AS endpoints
        ON endpoints.connection_id = connections.id
      JOIN shared_channels AS channels
        ON channels.id = endpoints.shared_channel_id
      WHERE channels.mode = 'hub'
        AND connections.state = 'active'
        AND connections.health = 'healthy'
    `);
    if (result.rows[0]?.ready) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("hub connectors did not become healthy");
}

async function waitForMessages(
  connection: Awaited<ReturnType<typeof connectToCommunity>>,
  channelId: string,
  marker: string,
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = await connection.readMessages({
      channelIds: [channelId],
      limit: 50,
      timeoutMs: 5_000,
    });
    const matches = messages
      .map((message) => message.content)
      .filter((content) => content.includes(marker));
    if (matches.length >= 3) return matches;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("projected messages did not arrive");
}

async function jsonRequest<T = unknown>(
  url: string,
  options: {
    body?: Record<string, unknown>;
    expectedStatus?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const response = await fetch(url, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
    method: options.body ? "POST" : "GET",
  });
  const expectedStatus = options.expectedStatus ?? 200;
  if (response.status !== expectedStatus) {
    throw new Error(`API ${new URL(url).pathname} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

function keyFromHex(value: string): Uint8Array {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("secondary relay private key is invalid");
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function localAppOrigin(value: string): string {
  const url = new URL(value);
  if (
    !["127.0.0.1", "localhost", "buzzrouter-accept-web"].includes(
      url.hostname,
    )
  ) {
    throw new Error("VERIFY_APP_ORIGIN must be the local acceptance server");
  }
  return url.origin;
}

main().catch((error) => {
  console.error(
    "FATAL",
    error instanceof Error ? error.message : "unknown production verification failure",
  );
  process.exit(1);
});
