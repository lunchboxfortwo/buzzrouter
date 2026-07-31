import type { Pool } from "pg";

import {
  createFileWrappingKeyProvider,
  createRelayConnectionFactory,
  type RelayConnectionFactory,
  type RelayGroup,
  type WrappingKeyProvider,
} from "./connector";
import {
  decryptConnectorPrivateKey,
  getOwnedCommunityConnection,
} from "./store";

export interface LocalChannelListing {
  channels: RelayGroup[];
  connectorActive: boolean;
}

/**
 * List the local channels of a community the caller owns by querying its relay
 * through the connector that is already installed and authenticated. Returns
 * `{ connectorActive: false, channels: [] }` when no active connector exists,
 * so the UI can prompt to connect rather than render an empty dropdown.
 */
export async function listCommunityLocalChannels(
  pool: Pool,
  input: { communityId: string; ownerPubkey: string },
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
  relayFactory: RelayConnectionFactory = createRelayConnectionFactory(),
): Promise<LocalChannelListing> {
  const connection = await getOwnedCommunityConnection(pool, input);
  if (!connection) {
    return { channels: [], connectorActive: false };
  }

  const wrappingKey = await wrappingKeys.getKey(
    connection.wrappingKeyVersion,
  );
  const privateKey = decryptConnectorPrivateKey(
    connection,
    wrappingKey,
    connection.communityId,
  );
  let relay:
    | Awaited<ReturnType<RelayConnectionFactory["connect"]>>
    | undefined;
  try {
    relay = await relayFactory.connect(connection.relayUrl, privateKey);
    const channels = await relay.listGroups();
    return { channels: sortChannels(channels), connectorActive: true };
  } finally {
    relay?.close();
    privateKey.fill(0);
  }
}

function sortChannels(channels: RelayGroup[]): RelayGroup[] {
  return [...channels].sort((first, second) =>
    first.name.localeCompare(second.name),
  );
}
