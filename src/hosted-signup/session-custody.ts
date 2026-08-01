import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { ApiError } from "../http/api-error";
import type { EncryptedConnectorKey } from "../shared-channels/store";

/**
 * AES-256-GCM custody for the Builderlab SESSION credential — the same wrapping
 * scheme as the connector-key custody in `src/shared-channels/store.ts`, but for
 * a variable-length string (`encryptConnectorPrivateKey` asserts a 32-byte
 * payload, so it can't wrap the session). The AAD is the bind pubkey, matching
 * the identity-key custody so the two ciphertexts are bound to the same
 * identity. The plaintext session never leaves this module except on decrypt.
 */

const WRAPPING_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

function aad(bindPubkey: string): Buffer {
  return Buffer.from(`buzzrouter:hosted-session:${bindPubkey}`, "utf8");
}

function assertWrappingKey(key: Uint8Array): void {
  if (key.byteLength !== WRAPPING_KEY_BYTES) {
    throw new ApiError("invalid_input", "Wrapping key must be 32 bytes.", 500);
  }
}

export function encryptSessionCredential(
  sessionCredential: string,
  wrappingKey: Uint8Array,
  bindPubkey: string,
): EncryptedConnectorKey {
  assertWrappingKey(wrappingKey);
  const nonce = randomBytes(GCM_NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(wrappingKey), nonce);
  cipher.setAAD(aad(bindPubkey));
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(sessionCredential, "utf8")),
    cipher.final(),
  ]);
  return { authTag: cipher.getAuthTag(), ciphertext, nonce };
}

export function decryptSessionCredential(
  encrypted: EncryptedConnectorKey,
  wrappingKey: Uint8Array,
  bindPubkey: string,
): string {
  assertWrappingKey(wrappingKey);
  if (
    encrypted.nonce.byteLength !== GCM_NONCE_BYTES ||
    encrypted.authTag.byteLength !== GCM_TAG_BYTES
  ) {
    throw new ApiError(
      "session_custody_invalid",
      "Session key material is invalid.",
      500,
    );
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(wrappingKey),
    encrypted.nonce,
  );
  decipher.setAAD(aad(bindPubkey));
  decipher.setAuthTag(encrypted.authTag);
  return Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
