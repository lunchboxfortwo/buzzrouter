import { readFile } from "node:fs/promises";

import { upsertCommunityIcon } from "../src/db/candidates";
import { createDatabasePool } from "../src/db/pool";
import { IMAGE_CONTENT_TYPES } from "../src/discovery/image-types";
import { normalizeRelayUrl } from "../src/discovery/normalize";
import { parseUploadedIcon } from "../src/discovery/nip11";

// Install a community's directory logo by hand, for a community whose relay
// advertises no NIP-11 icon and that never came through the submission form.
// It writes the same community_icons row those two paths write, so the Discover
// row and the community page pick it up with no further change.
// Usage: npm run community:icon -- wss://relay.example.com path/to/logo.png
const [relayArgument, iconPath] = process.argv.slice(2);
if (!relayArgument || !iconPath) {
  console.error("Usage: npm run community:icon -- <relay-url> <image-file>");
  process.exit(1);
}
const { canonicalRelayUrl } = normalizeRelayUrl(relayArgument);

const bytes = await readFile(iconPath);
// Trust the bytes, not the file extension: parseUploadedIcon accepts a type
// only when the magic bytes match it, so the one that parses is the real type.
const icon = IMAGE_CONTENT_TYPES.map((contentType) =>
  parseUploadedIcon(bytes, contentType),
).find((parsed) => parsed !== null);
if (!icon) {
  throw new Error(
    `${iconPath} is not a PNG, JPEG, GIF, or WebP within the size limit.`,
  );
}

const pool = createDatabasePool();
try {
  const result = await pool.query<{ id: string }>(
    "SELECT id FROM community_candidates WHERE canonical_relay_url = $1",
    [canonicalRelayUrl],
  );
  const candidate = result.rows[0];
  if (!candidate) {
    throw new Error(`No community candidate for ${canonicalRelayUrl}.`);
  }

  await upsertCommunityIcon(pool, candidate.id, icon);
  console.log(
    `Set ${icon.contentType} icon (${icon.bytes.length} bytes) for ` +
      `${canonicalRelayUrl} at /api/community-icons/${candidate.id}.`,
  );
} finally {
  await pool.end();
}
