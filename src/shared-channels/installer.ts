import { createHash, randomBytes } from "node:crypto";

import { npubEncode } from "nostr-tools/nip19";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { Pool } from "pg";

import { normalizeRelayUrl } from "../discovery/normalize";
import { ApiError } from "../http/api-error";
import { signNip98 } from "../http/nip98-client";
import { canonicalRequestUrl } from "../http/nostr-auth";
import {
  createFileWrappingKeyProvider,
  createRelayConnectionFactory,
  type RelayConnectionFactory,
  type WrappingKeyProvider,
} from "./connector";
import {
  mintOwnerSession,
  type MintedOwnerSession,
} from "./owner-session";
import {
  activateCommunityConnection,
  beginCommunityConnectionInstall,
  decryptConnectorPrivateKey,
  enrollVerifiedCommunityFromInvite,
  findVerifiedCommunityCandidateByRelayUrl,
  getCommunityConnectionInstallContext,
  type CommunityConnectionRecord,
  type VerifiedCommunityIdentity,
} from "./store";

const INSTALL_TOKEN_BYTES = 32;
const DEFAULT_WRAPPING_KEY_VERSION = 1;

export interface CommunityInstallToken {
  bridgeNpub: string;
  bridgePubkey: string;
  // The self-host connector command. Null when the connector package is not
  // published — the owner admits the bridge from their Buzz app instead.
  command: string | null;
  expiresAt: string;
  relayUrl: string;
  token: string;
}

export interface CommunityInstallDescriptor {
  bridgePubkey: string;
  expiresAt: string;
  relayUrl: string;
}

export async function createCommunityInstallToken(
  pool: Pool,
  input: {
    communityId: string;
    ownerPubkey: string;
  },
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  privateKey: Uint8Array = generateSecretKey(),
): Promise<CommunityInstallToken> {
  const token = randomBytes(INSTALL_TOKEN_BYTES).toString("base64url");
  const command = optionalInstallerCommand(token);
  const bridgePubkey = getPublicKey(privateKey);
  const bridgeNpub = npubEncode(bridgePubkey);
  const wrappingKeyVersion = configuredWrappingKeyVersion();

  try {
    const wrappingKey = await wrappingKeys.getKey(wrappingKeyVersion);
    const result = await beginCommunityConnectionInstall(pool, {
      bridgePubkey,
      communityId: input.communityId,
      ownerPubkey: input.ownerPubkey,
      privateKey,
      tokenHash: hashInstallToken(token),
      wrappingKey,
      wrappingKeyVersion,
    });
    return {
      bridgeNpub,
      bridgePubkey,
      command,
      expiresAt: result.expiresAt,
      relayUrl: result.connection.relayUrl,
      token,
    };
  } finally {
    privateKey.fill(0);
  }
}

export async function getCommunityInstallDescriptor(
  pool: Pool,
  token: string,
): Promise<CommunityInstallDescriptor> {
  const context = await getCommunityConnectionInstallContext(
    pool,
    hashInstallToken(token),
  );
  return {
    bridgePubkey: context.bridgePubkey,
    expiresAt: context.expiresAt,
    relayUrl: context.relayUrl,
  };
}

export async function verifyAndActivateCommunityConnection(
  pool: Pool,
  token: string,
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  relayFactory: RelayConnectionFactory = createRelayConnectionFactory(),
): Promise<CommunityConnectionRecord> {
  const tokenHash = hashInstallToken(token);
  const context = await getCommunityConnectionInstallContext(
    pool,
    tokenHash,
  );
  const wrappingKey = await wrappingKeys.getKey(
    context.wrappingKeyVersion,
  );
  const privateKey = decryptConnectorPrivateKey(
    context,
    wrappingKey,
    context.communityId,
  );
  let relay: Awaited<ReturnType<RelayConnectionFactory["connect"]>> | undefined;

  try {
    relay = await relayFactory.connect(context.relayUrl, privateKey);
    const event = finalizeEvent(
      {
        content: JSON.stringify({
          about:
            "Routes explicitly approved BuzzRouter shared channels.",
          display_name: "BuzzRouter Bridge",
          name: "buzzrouter-bridge",
        }),
        created_at: Math.floor(Date.now() / 1_000),
        kind: 0,
        tags: [["client", "buzzrouter-installer"]],
      },
      privateKey,
    );
    await relay.publish(event);
    if (!(await relay.hasEvent(event.id))) {
      throw new ApiError(
        "connector_round_trip_failed",
        "The relay did not return the connector verification event.",
        502,
      );
    }
    return await activateCommunityConnection(pool, tokenHash, {
      bridgePubkey: context.bridgePubkey,
      relayUrl: context.relayUrl,
      verificationEventId: event.id,
      verifiedAt: new Date().toISOString(),
    });
  } finally {
    relay?.close();
    privateKey.fill(0);
  }
}

export interface BeginConnectionFromInviteResult {
  communityId: string;
  displayName: string;
  expiresAt: string;
  relayUrl: string;
  session: string;
}

/**
 * The whole signer-free admission in one step: a mobile owner with no NIP-07
 * signer pastes an invite LINK from their Buzz app. We identify their verified
 * community from the link's relay host (no signature), let the bridge redeem the
 * invite and prove admission, then mint a short-lived, community-scoped owner
 * session the "Link" page uses in place of a browser signature. Binding a shared
 * channel still needs the roster-signed code typed in-channel — the session only
 * stands in for the owner signature, never for that proof.
 */
export async function beginConnectionFromInvite(
  pool: Pool,
  invite: string,
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  relayFactory: RelayConnectionFactory = createRelayConnectionFactory(),
  claimInvite: InviteClaimFn = claimInviteOverHttp,
): Promise<BeginConnectionFromInviteResult> {
  const canonicalRelayUrl = inviteRelayUrl(invite);
  const candidate = await findVerifiedCommunityCandidateByRelayUrl(
    pool,
    canonicalRelayUrl,
  );
  const privateKey = generateSecretKey();
  let community: VerifiedCommunityIdentity;
  let token: CommunityInstallToken;
  try {
    await redeemInviteWithBridgeKey(
      privateKey,
      candidate.relayUrl,
      invite,
      claimInvite,
    );
    community = await enrollVerifiedCommunityFromInvite(
      pool,
      candidate.candidateId,
      randomBytes(32).toString("hex"),
    );
    token = await createCommunityInstallToken(
      pool,
      {
        communityId: community.communityId,
        ownerPubkey: community.ownerPubkey,
      },
      wrappingKeys,
      privateKey,
    );
  } finally {
    privateKey.fill(0);
  }
  await verifyAndActivateCommunityConnection(
    pool,
    token.token,
    wrappingKeys,
    relayFactory,
  );
  const session: MintedOwnerSession = await mintOwnerSession(pool, {
    communityId: community.communityId,
    ownerPubkey: community.ownerPubkey,
  });
  return {
    communityId: community.communityId,
    displayName: community.displayName,
    expiresAt: session.expiresAt,
    relayUrl: community.relayUrl,
    session: session.session,
  };
}

/**
 * Derive the canonical relay URL a Buzz invite LINK points at (its HTTP host is
 * the relay host). A bare code carries no host, so it cannot identify a
 * community on its own — the signer-free entry needs the full link.
 */
function inviteRelayUrl(invite: string): string {
  const trimmed = invite.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new ApiError(
      "invite_invalid",
      "Paste the full invite link from your Buzz app.",
      400,
    );
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ApiError("invite_invalid", "The invite link is invalid.", 400);
  }
  try {
    return normalizeRelayUrl(`wss://${url.host}`).canonicalRelayUrl;
  } catch {
    throw new ApiError(
      "invite_invalid",
      "The invite link host is invalid.",
      400,
    );
  }
}

export interface InviteClaimTarget {
  claimUrl: string;
  code: string;
}

export type InviteClaimFn = (
  privateKey: Uint8Array,
  target: InviteClaimTarget,
) => Promise<void>;

export async function redeemInviteWithBridgeKey(
  privateKey: Uint8Array,
  relayUrlOnRecord: string,
  invite: string,
  claimInvite: InviteClaimFn = claimInviteOverHttp,
): Promise<void> {
  const target = resolveInviteClaimTarget(relayUrlOnRecord, invite);
  await claimInvite(privateKey, target);
}

/**
 * PRIMARY admission path: the owner mints an invite link in their Buzz app and
 * pastes it here. The bridge redeems the link itself (POST /api/invites/claim,
 * NIP-98 signed by the bridge key — the joining pubkey) so the owner never
 * handles a key, then the unchanged kind-0 round trip proves real admission.
 */
export async function redeemInviteAndActivate(
  pool: Pool,
  token: string,
  invite: string,
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  relayFactory: RelayConnectionFactory = createRelayConnectionFactory(),
  claimInvite: InviteClaimFn = claimInviteOverHttp,
): Promise<CommunityConnectionRecord> {
  const tokenHash = hashInstallToken(token);
  const context = await getCommunityConnectionInstallContext(
    pool,
    tokenHash,
  );
  // Resolve (and host-validate) the invite before touching key material, so a
  // bad link fails fast without decrypting the bridge key.
  const target = resolveInviteClaimTarget(context.relayUrl, invite);
  const wrappingKey = await wrappingKeys.getKey(
    context.wrappingKeyVersion,
  );
  const privateKey = decryptConnectorPrivateKey(
    context,
    wrappingKey,
    context.communityId,
  );
  try {
    await claimInvite(privateKey, target);
  } finally {
    privateKey.fill(0);
  }
  return verifyAndActivateCommunityConnection(
    pool,
    token,
    wrappingKeys,
    relayFactory,
  );
}

/**
 * Extracts the invite code and derives the claim URL, pinning it to the relay
 * already on record for this community. A pasted link may only point at that
 * exact relay — this is the SSRF control that stops a crafted link redirecting
 * the bridge's signed request at an arbitrary host.
 */
export function resolveInviteClaimTarget(
  relayUrlOnRecord: string,
  invite: string,
): InviteClaimTarget {
  const parsed = parseInvite(invite);
  const record = normalizeRelayUrl(relayUrlOnRecord);

  if (parsed.url) {
    let pasted;
    try {
      pasted = normalizeRelayUrl(parsed.url.toString());
    } catch {
      throw new ApiError(
        "invite_invalid",
        "The invite link host is invalid.",
        400,
      );
    }
    if (pasted.canonicalRelayUrl !== record.canonicalRelayUrl) {
      throw new ApiError(
        "invite_host_mismatch",
        "That invite link is for a different relay than this community.",
        400,
      );
    }
  }

  const authority = record.canonicalRelayUrl.slice("wss://".length);
  return {
    claimUrl: `https://${authority}/api/invites/claim`,
    code: parsed.code,
  };
}

function parseInvite(invite: string): { code: string; url: URL | null } {
  const trimmed = invite.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new ApiError("invite_invalid", "The invite link is invalid.", 400);
    }
    const match = /\/invite\/([^/?#]+)/.exec(url.pathname);
    if (!match) {
      throw new ApiError(
        "invite_invalid",
        "The invite link is missing an invite code.",
        400,
      );
    }
    return { code: decodeURIComponent(match[1]), url };
  }
  if (!/^[A-Za-z0-9._~+/=-]{1,900}$/.test(trimmed)) {
    throw new ApiError("invite_invalid", "The invite code is invalid.", 400);
  }
  return { code: trimmed, url: null };
}

async function claimInviteOverHttp(
  privateKey: Uint8Array,
  target: InviteClaimTarget,
): Promise<void> {
  const body = JSON.stringify({ code: target.code });
  const authorization = signNip98(privateKey, {
    body,
    method: "POST",
    url: target.claimUrl,
  });

  let response: Response;
  try {
    response = await fetch(target.claimUrl, {
      body,
      headers: {
        authorization: `Nostr ${authorization}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
  } catch (error) {
    throw new ApiError(
      "invite_claim_unreachable",
      "The community relay could not be reached to redeem the invite.",
      502,
      { cause: error },
    );
  }

  if (!response.ok) {
    throw new ApiError(
      "invite_claim_rejected",
      `The relay rejected the invite (status ${response.status}).`,
      502,
    );
  }
}

export function hashInstallToken(token: string): string {
  if (
    typeof token !== "string" ||
    !/^[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    throw new ApiError("invalid_input", "Install token is invalid.");
  }
  return createHash("sha256").update(token).digest("hex");
}

function configuredWrappingKeyVersion(): number {
  const raw =
    process.env.BUZZROUTER_CONNECTOR_WRAPPING_KEY_VERSION ??
    String(DEFAULT_WRAPPING_KEY_VERSION);
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new ApiError(
      "wrapping_key_version_invalid",
      "Connector wrapping-key version is invalid.",
      500,
    );
  }
  return version;
}

/**
 * The self-host connector command is a demoted convenience. When the connector
 * package is not published, hosted owners admit the bridge from their Buzz app
 * instead, so a missing package returns null rather than blocking the token.
 */
function optionalInstallerCommand(token: string): string | null {
  try {
    return buildInstallerCommand(token);
  } catch (error) {
    if (
      error instanceof ApiError &&
      error.code === "connector_package_unavailable"
    ) {
      return null;
    }
    throw error;
  }
}

export function buildInstallerCommand(token: string): string {
  const packageSpec = process.env.BUZZROUTER_CONNECT_PACKAGE_SPEC;
  if (!packageSpec || !isAllowedPackageSpec(packageSpec)) {
    throw new ApiError(
      "connector_package_unavailable",
      "The connector installer is not published.",
      503,
    );
  }
  const origin = new URL(canonicalRequestUrl("/"));
  return `npx --yes --package=${packageSpec} buzzrouter-connect ${token} --router ${origin.origin}`;
}

function isAllowedPackageSpec(packageSpec: string): boolean {
  if (
    /^@buzzrouter\/connect@[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(
      packageSpec,
    )
  ) {
    return true;
  }

  const release =
    /^https:\/\/github\.com\/lunchboxfortwo\/buzzrouter\/releases\/download\/connect-v([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\/buzzrouter-connect-([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)\.tgz$/.exec(
      packageSpec,
    );
  return release !== null && release[1] === release[2];
}
