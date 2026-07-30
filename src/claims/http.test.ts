import { createHash } from "node:crypto";

import {
  finalizeEvent,
  generateSecretKey,
} from "nostr-tools/pure";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticateJsonRequest,
  claimErrorResponse,
  isUuid,
} from "./http";

const originalOrigin = process.env.PUBLIC_APP_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) {
    delete process.env.PUBLIC_APP_ORIGIN;
  } else {
    process.env.PUBLIC_APP_ORIGIN = originalOrigin;
  }
});

describe("authenticateJsonRequest", () => {
  it("authenticates the canonical public URL and consumes the event", async () => {
    process.env.PUBLIC_APP_ORIGIN = "https://buzzrouter.com";
    const body = '{"method":"dns_txt"}';
    const publicUrl =
      "https://buzzrouter.com/api/claims/challenges?source=workspace";
    const event = finalizeEvent(
      {
        content: "",
        created_at: Math.floor(Date.now() / 1_000),
        kind: 27_235,
        tags: [
          ["u", publicUrl],
          ["method", "POST"],
          ["payload", createHash("sha256").update(body).digest("hex")],
        ],
      },
      generateSecretKey(),
    );
    const query = vi.fn().mockResolvedValue({ rows: [{ id: event.id }] });
    const request = new Request(
      "http://internal-host/api/claims/challenges?source=workspace",
      {
        body,
        headers: {
          authorization: `Nostr ${Buffer.from(
            JSON.stringify(event),
          ).toString("base64")}`,
          "content-type": "application/json",
        },
        method: "POST",
      },
    );

    await expect(
      authenticateJsonRequest(request, { query } as unknown as Pool),
    ).resolves.toMatchObject({
      pubkey: event.pubkey,
      rawBody: body,
      value: { method: "dns_txt" },
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO nostr_auth_events"),
      expect.arrayContaining([event.id, publicUrl, "POST"]),
    );
  });

  it("rejects oversized bodies before authentication", async () => {
    const request = new Request("https://buzzrouter.com/api/test", {
      body: "x",
      headers: { "content-length": "20000" },
      method: "POST",
    });

    await expect(
      authenticateJsonRequest(request, {} as Pool),
    ).rejects.toMatchObject({ code: "invalid_input", status: 413 });
  });
});

describe("claim HTTP helpers", () => {
  it("recognizes canonical UUIDs and emits stable error payloads", async () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);

    const response = claimErrorResponse(new Error("database detail"));
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "challenge_failed",
    });
  });
});
