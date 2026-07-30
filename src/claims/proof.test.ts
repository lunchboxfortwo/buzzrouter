import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClaimInstructions,
  createTokenHash,
  validateIconToken,
} from "./proof";
import type { ClaimChallengeRecord } from "./store";

const token = "a".repeat(43);
const challenge: ClaimChallengeRecord = {
  attempts: 0,
  canonicalRelayUrl: "wss://relay.example",
  candidateId: "11111111-1111-4111-8111-111111111111",
  challengeId: "22222222-2222-4222-8222-222222222222",
  claimantPubkey: "b".repeat(64),
  expiresAt: "2026-07-30T12:00:00.000Z",
  host: "relay.example",
  method: "dns_txt",
  tokenHash: createTokenHash(token),
};

const originalOrigin = process.env.PUBLIC_APP_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) {
    delete process.env.PUBLIC_APP_ORIGIN;
  } else {
    process.env.PUBLIC_APP_ORIGIN = originalOrigin;
  }
});

describe("createClaimInstructions", () => {
  it("creates DNS and HTTPS proofs bound to the claimant", () => {
    expect(createClaimInstructions(challenge, token)).toEqual({
      method: "dns_txt",
      name: "_buzzrouter.relay.example",
      value: `buzzrouter-claim=${token}`,
    });
    expect(
      createClaimInstructions(
        { ...challenge, method: "http_file" },
        token,
      ),
    ).toEqual({
      method: "http_file",
      url: "https://relay.example/.well-known/buzzrouter.json",
      value: JSON.stringify({
        nonce: token,
        pubkey: challenge.claimantPubkey,
      }),
    });
  });

  it("uses the configured public origin for hosted icon proofs", () => {
    process.env.PUBLIC_APP_ORIGIN = "https://buzzrouter.com";
    expect(
      createClaimInstructions(
        {
          ...challenge,
          host: "demo.communities.buzz.xyz",
          method: "hosted_icon",
        },
        token,
      ).url,
    ).toBe(
      `https://buzzrouter.com/api/claims/icon/${challenge.challengeId}/${token}.png`,
    );
  });
});

describe("validateIconToken", () => {
  it("hashes a well-formed token before consulting persistence", async () => {
    const isValid = vi.fn().mockResolvedValue(true);
    const pool = {} as Pool;

    await expect(
      validateIconToken(pool, challenge.challengeId, token, isValid),
    ).resolves.toBe(true);
    expect(isValid).toHaveBeenCalledWith(
      pool,
      challenge.challengeId,
      createTokenHash(token),
    );
  });

  it("rejects malformed tokens without a database lookup", async () => {
    const isValid = vi.fn();
    await expect(
      validateIconToken(
        {} as Pool,
        challenge.challengeId,
        "../bad",
        isValid,
      ),
    ).resolves.toBe(false);
    expect(isValid).not.toHaveBeenCalled();
  });
});
