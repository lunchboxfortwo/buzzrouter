import { createECDH, randomBytes } from "node:crypto";

import { getPublicKey } from "nostr-tools/pure";
import { describe, expect, test } from "vitest";

import {
  deriveSas,
  deriveSessionId,
  deriveTranscriptHash,
  pairingUri,
} from "./pair-android-buzz";

describe("Android Buzz pairing protocol", () => {
  test("derives the same SAS from either side of secp256k1 ECDH", () => {
    const sourcePrivate = randomBytes(32);
    const targetPrivate = randomBytes(32);
    const sessionSecret = randomBytes(32);
    const sourcePublic = getPublicKey(sourcePrivate);
    const targetPublic = getPublicKey(targetPrivate);

    const source = deriveSas(sourcePrivate, targetPublic, sessionSecret);
    const target = deriveSas(targetPrivate, sourcePublic, sessionSecret);

    expect(source.code).toMatch(/^\d{6}$/);
    expect(target).toEqual(source);
  });

  test("binds the transcript to source, target, session, and SAS", () => {
    const sourcePrivate = randomBytes(32);
    const targetPrivate = randomBytes(32);
    const sessionSecret = randomBytes(32);
    const sessionId = deriveSessionId(sessionSecret);
    const sourcePublic = getPublicKey(sourcePrivate);
    const targetPublic = getPublicKey(targetPrivate);
    const sas = deriveSas(sourcePrivate, targetPublic, sessionSecret);

    const first = deriveTranscriptHash({
      sessionId,
      sourcePublicKeyHex: sourcePublic,
      targetPublicKeyHex: targetPublic,
      sasInput: sas.input,
      sessionSecret,
    });
    const swapped = deriveTranscriptHash({
      sessionId,
      sourcePublicKeyHex: targetPublic,
      targetPublicKeyHex: sourcePublic,
      sasInput: sas.input,
      sessionSecret,
    });

    expect(first).toHaveLength(32);
    expect(first).not.toEqual(swapped);
  });

  test("encodes the NIP-AB URI fields mobile requires", () => {
    const sourcePrivate = randomBytes(32);
    const sessionSecret = randomBytes(32);
    const uri = new URL(
      pairingUri({
        sourcePublicKeyHex: getPublicKey(sourcePrivate),
        sessionSecret,
        pairingRelay: "wss://pairing.buzz.xyz",
      }),
    );

    expect(uri.protocol).toBe("nostrpair:");
    expect(uri.hostname).toMatch(/^[0-9a-f]{64}$/);
    expect(uri.searchParams.get("secret")).toMatch(/^[0-9a-f]{64}$/);
    expect(uri.searchParams.get("relay")).toBe("wss://pairing.buzz.xyz");
    expect(uri.searchParams.get("v")).toBe("1");
  });
});
