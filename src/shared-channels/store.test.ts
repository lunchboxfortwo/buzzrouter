import { randomBytes, randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  decryptConnectorPrivateKey,
  encryptConnectorPrivateKey,
} from "./store";

describe("connector key encryption", () => {
  it("round-trips a connector key only for its community", () => {
    const privateKey = randomBytes(32);
    const wrappingKey = randomBytes(32);
    const communityId = randomUUID();
    const encrypted = encryptConnectorPrivateKey(
      privateKey,
      wrappingKey,
      communityId,
    );

    expect(encrypted.ciphertext).not.toEqual(privateKey);
    expect(
      decryptConnectorPrivateKey(
        encrypted,
        wrappingKey,
        communityId,
      ),
    ).toEqual(privateKey);
    expect(() =>
      decryptConnectorPrivateKey(
        encrypted,
        wrappingKey,
        randomUUID(),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "connector_key_unavailable" }),
    );
  });

  it("fails closed with the wrong wrapping key", () => {
    const communityId = randomUUID();
    const encrypted = encryptConnectorPrivateKey(
      randomBytes(32),
      randomBytes(32),
      communityId,
    );

    expect(() =>
      decryptConnectorPrivateKey(
        encrypted,
        randomBytes(32),
        communityId,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "connector_key_unavailable" }),
    );
  });
});
