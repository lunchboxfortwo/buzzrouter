import { readFileSync } from "node:fs";

import { nip19 } from "nostr-tools";
import { getPublicKey } from "nostr-tools/pure";

/**
 * Loads the BuzzRouter agent keypair used to NIP-42 authenticate against Buzz
 * relays and to sign NIP-98 invite claims. The private key is read from either
 * the `BUZZ_AGENT_KEY` environment override (hex or nsec) or the gitignored
 * secrets file. It is never logged and never leaves the process.
 */

const DEFAULT_IDENTITY_FILE = ".secrets/buzz-agent.identity.json";
const HEX_KEY = /^[0-9a-f]{64}$/i;

export interface AgentIdentity {
  privateKey: Uint8Array;
  publicKeyHex: string;
  npub: string;
}

export interface LoadIdentityOptions {
  /** Explicit key override (hex or nsec). Defaults to `BUZZ_AGENT_KEY`. */
  envKey?: string;
  /** Identity file path. Defaults to `BUZZ_AGENT_IDENTITY_FILE` or the secrets file. */
  filePath?: string;
}

/** Parses a private key expressed as 64-character hex or an `nsec1...` string. */
export function parseAgentKey(raw: string): Uint8Array {
  const value = raw.trim();
  if (value.startsWith("nsec")) {
    const decoded = nip19.decode(value);
    if (decoded.type !== "nsec") {
      throw new Error("Agent key is not a valid nsec key.");
    }
    return decoded.data;
  }
  if (!HEX_KEY.test(value)) {
    throw new Error(
      "Agent key must be a 64-character hex string or an nsec key.",
    );
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

/** Derives the public identity (hex + npub) from a private key. */
export function identityFromPrivateKey(
  privateKey: Uint8Array,
): AgentIdentity {
  const publicKeyHex = getPublicKey(privateKey);
  return {
    npub: nip19.npubEncode(publicKeyHex),
    privateKey,
    publicKeyHex,
  };
}

/**
 * Resolves the agent identity from the environment override or the secrets
 * file. Throws a clear, actionable error when neither is available.
 */
export function loadAgentIdentity(
  options: LoadIdentityOptions = {},
): AgentIdentity {
  const envKey = options.envKey ?? process.env.BUZZ_AGENT_KEY;
  if (envKey && envKey.trim().length > 0) {
    return identityFromPrivateKey(parseAgentKey(envKey));
  }

  const filePath =
    options.filePath ??
    process.env.BUZZ_AGENT_IDENTITY_FILE ??
    DEFAULT_IDENTITY_FILE;

  let contents: string;
  try {
    contents = readFileSync(filePath, "utf8");
  } catch {
    throw new Error(
      `No agent identity available. Set BUZZ_AGENT_KEY (hex or nsec) or ` +
        `provide an identity file at ${filePath}.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error(`Agent identity file ${filePath} is not valid JSON.`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`Agent identity file ${filePath} is malformed.`);
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.privateKeyHex === "string") {
    return identityFromPrivateKey(parseAgentKey(record.privateKeyHex));
  }
  if (typeof record.nsec === "string") {
    return identityFromPrivateKey(parseAgentKey(record.nsec));
  }

  throw new Error(
    `Agent identity file ${filePath} is missing privateKeyHex or nsec.`,
  );
}
