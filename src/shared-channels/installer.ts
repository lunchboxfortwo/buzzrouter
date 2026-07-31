import { createHash, randomBytes } from "node:crypto";

import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { Pool } from "pg";

import { ApiError } from "../http/api-error";
import { canonicalRequestUrl } from "../http/nostr-auth";
import {
  createFileWrappingKeyProvider,
  createRelayConnectionFactory,
  type RelayConnectionFactory,
  type WrappingKeyProvider,
} from "./connector";
import {
  activateCommunityConnection,
  beginCommunityConnectionInstall,
  decryptConnectorPrivateKey,
  getCommunityConnectionInstallContext,
  type CommunityConnectionRecord,
} from "./store";

const INSTALL_TOKEN_BYTES = 32;
const DEFAULT_WRAPPING_KEY_VERSION = 1;

export interface CommunityInstallToken {
  bridgePubkey: string;
  command: string;
  expiresAt: string;
  relayUrl: string;
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
): Promise<CommunityInstallToken> {
  const token = randomBytes(INSTALL_TOKEN_BYTES).toString("base64url");
  const command = buildInstallerCommand(token);
  const privateKey = generateSecretKey();
  const bridgePubkey = getPublicKey(privateKey);
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
      bridgePubkey,
      command,
      expiresAt: result.expiresAt,
      relayUrl: result.connection.relayUrl,
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
