import { createHash } from "node:crypto";

import {
  finalizeEvent,
  generateSecretKey,
} from "nostr-tools/pure";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canonicalRequestUrl,
  consumeNip98Event,
  verifyNip98Authorization,
} from "./nip98";

const secret = generateSecretKey();
const now = 1_785_391_200;
const url = "https://buzzrouter.com/api/claims/challenges";
const body = '{"candidateId":"candidate","method":"dns_txt"}';

function authorization(
  overrides: Partial<{
    createdAt: number;
    method: string;
    payload: string;
    url: string;
  }> = {},
) {
  const event = finalizeEvent(
    {
      content: "",
      created_at: overrides.createdAt ?? now,
      kind: 27_235,
      tags: [
        ["u", overrides.url ?? url],
        ["method", overrides.method ?? "POST"],
        [
          "payload",
          overrides.payload ??
            createHash("sha256").update(body).digest("hex"),
        ],
      ],
    },
    secret,
  );

  return `Nostr ${Buffer.from(JSON.stringify(event)).toString("base64")}`;
}

describe("verifyNip98Authorization", () => {
  it("verifies a current signed request with an exact payload hash", () => {
    expect(
      verifyNip98Authorization(
        authorization(),
        url,
        "POST",
        body,
        now,
      ),
    ).toMatchObject({
      eventId: expect.stringMatching(/^[a-f0-9]{64}$/),
      pubkey: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  it("rejects URL, method, payload, and time mismatches", () => {
    expect(() =>
      verifyNip98Authorization(
        authorization({ url: `${url}/other` }),
        url,
        "POST",
        body,
        now,
      ),
    ).toThrow("invalid");
    expect(() =>
      verifyNip98Authorization(
        authorization({ method: "PUT" }),
        url,
        "POST",
        body,
        now,
      ),
    ).toThrow("invalid");
    expect(() =>
      verifyNip98Authorization(
        authorization({ payload: "0".repeat(64) }),
        url,
        "POST",
        body,
        now,
      ),
    ).toThrow("invalid");
    expect(() =>
      verifyNip98Authorization(
        authorization({ createdAt: now - 61 }),
        url,
        "POST",
        body,
        now,
      ),
    ).toThrow("invalid");
  });
});

describe("consumeNip98Event", () => {
  it("rejects a replayed event ID", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as unknown as Pool;

    await expect(
      consumeNip98Event(
        pool,
        {
          createdAt: now,
          eventId: "a".repeat(64),
          pubkey: "b".repeat(64),
        },
        url,
        "POST",
      ),
    ).rejects.toMatchObject({ code: "authentication_replayed" });
  });
});

describe("canonicalRequestUrl", () => {
  const originalOrigin = process.env.PUBLIC_APP_ORIGIN;

  afterEach(() => {
    if (originalOrigin === undefined) {
      delete process.env.PUBLIC_APP_ORIGIN;
    } else {
      process.env.PUBLIC_APP_ORIGIN = originalOrigin;
    }
  });

  it("uses the configured public origin rather than request host headers", () => {
    process.env.PUBLIC_APP_ORIGIN = "https://buzzrouter.com";
    expect(canonicalRequestUrl("/api/test?one=two")).toBe(
      "https://buzzrouter.com/api/test?one=two",
    );
  });

  it("allows loopback HTTP for local release checks", () => {
    process.env.PUBLIC_APP_ORIGIN = "http://127.0.0.1:3210";
    expect(canonicalRequestUrl("/api/test")).toBe(
      "http://127.0.0.1:3210/api/test",
    );
  });
});
