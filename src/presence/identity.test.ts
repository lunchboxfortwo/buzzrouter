import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { nip19 } from "nostr-tools";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";

import {
  identityFromPrivateKey,
  loadAgentIdentity,
  parseAgentKey,
} from "./identity";

const secret = generateSecretKey();
const secretHex = Buffer.from(secret).toString("hex");

describe("parseAgentKey", () => {
  it("parses 64-character hex", () => {
    expect(parseAgentKey(secretHex)).toEqual(secret);
  });

  it("parses an nsec key", () => {
    const nsec = nip19.nsecEncode(secret);
    expect(parseAgentKey(nsec)).toEqual(secret);
  });

  it("rejects malformed keys", () => {
    expect(() => parseAgentKey("not-a-key")).toThrow();
    expect(() => parseAgentKey("abc123")).toThrow();
  });
});

describe("identityFromPrivateKey", () => {
  it("derives the hex pubkey and npub", () => {
    const identity = identityFromPrivateKey(secret);
    expect(identity.publicKeyHex).toBe(getPublicKey(secret));
    expect(identity.npub).toBe(nip19.npubEncode(getPublicKey(secret)));
    expect(identity.privateKey).toEqual(secret);
  });
});

describe("loadAgentIdentity", () => {
  it("prefers the BUZZ_AGENT_KEY override", () => {
    const identity = loadAgentIdentity({ envKey: secretHex });
    expect(identity.publicKeyHex).toBe(getPublicKey(secret));
  });

  it("loads privateKeyHex from an identity file", () => {
    const dir = mkdtempSync(join(tmpdir(), "buzz-identity-"));
    const file = join(dir, "identity.json");
    writeFileSync(
      file,
      JSON.stringify({
        npub: nip19.npubEncode(getPublicKey(secret)),
        privateKeyHex: secretHex,
        publicKeyHex: getPublicKey(secret),
      }),
    );
    const identity = loadAgentIdentity({ envKey: "", filePath: file });
    expect(identity.publicKeyHex).toBe(getPublicKey(secret));
  });

  it("falls back to nsec in the identity file", () => {
    const dir = mkdtempSync(join(tmpdir(), "buzz-identity-"));
    const file = join(dir, "identity.json");
    writeFileSync(file, JSON.stringify({ nsec: nip19.nsecEncode(secret) }));
    const identity = loadAgentIdentity({ envKey: "", filePath: file });
    expect(identity.publicKeyHex).toBe(getPublicKey(secret));
  });

  it("throws a clear error when nothing is available", () => {
    expect(() =>
      loadAgentIdentity({
        envKey: "",
        filePath: join(tmpdir(), "does-not-exist-buzz.json"),
      }),
    ).toThrow(/No agent identity available/);
  });
});
