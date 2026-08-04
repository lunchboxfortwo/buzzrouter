import { normalizeRelayUrl } from "../src/discovery/normalize";
import { createDatabasePool } from "../src/db/pool";
import {
  createFileWrappingKeyProvider,
  createRelayConnectionFactory,
} from "../src/shared-channels/connector";
import {
  BRIDGE_PROFILE_CONTENT,
  buildBridgeProfileEvent,
} from "../src/shared-channels/installer";
import { decryptConnectorPrivateKey } from "../src/shared-channels/store";

// Republish the bridge's kind-0 profile for one already-active community
// connection. Activation publishes it once, so a community admitted before
// BRIDGE_PROFILE_CONTENT last changed still shows the old name until this runs.
// Usage: npm run bridge:profile -- wss://relay.example.com
const relayArgument = process.argv[2];
if (!relayArgument) {
  console.error("Usage: npm run bridge:profile -- <relay-url>");
  process.exit(1);
}
const { canonicalRelayUrl } = normalizeRelayUrl(relayArgument);

const pool = createDatabasePool();
try {
  const result = await pool.query<{
    bridge_pubkey: string;
    community_id: string;
    encrypted_private_key: Buffer;
    private_key_auth_tag: Buffer;
    private_key_nonce: Buffer;
    wrapping_key_version: number;
  }>(
    `
      SELECT
        bridge_pubkey,
        community_id,
        encrypted_private_key,
        private_key_auth_tag,
        private_key_nonce,
        wrapping_key_version
      FROM community_connections
      WHERE relay_url_snapshot = $1
        AND state = 'active'
    `,
    [canonicalRelayUrl],
  );
  const connection = result.rows[0];
  if (!connection) {
    throw new Error(`No active community connection for ${canonicalRelayUrl}.`);
  }

  const wrappingKey = await createFileWrappingKeyProvider().getKey(
    connection.wrapping_key_version,
  );
  const privateKey = decryptConnectorPrivateKey(
    {
      authTag: connection.private_key_auth_tag,
      ciphertext: connection.encrypted_private_key,
      nonce: connection.private_key_nonce,
    },
    wrappingKey,
    connection.community_id,
  );
  const relay = await createRelayConnectionFactory().connect(
    canonicalRelayUrl,
    privateKey,
  );
  try {
    const event = buildBridgeProfileEvent(privateKey);
    await relay.publish(event);
    if (!(await relay.hasEvent(event.id))) {
      throw new Error("The relay did not return the published profile.");
    }
    console.log(
      `Published ${event.id} for ${connection.bridge_pubkey} on ` +
        `${canonicalRelayUrl}: ${BRIDGE_PROFILE_CONTENT}`,
    );
  } finally {
    relay.close();
    privateKey.fill(0);
  }
} finally {
  await pool.end();
}
