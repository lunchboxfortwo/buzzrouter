import {
  finalizeEvent,
  generateSecretKey,
} from "nostr-tools/pure";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authenticateRequest } from "./nostr-auth";

const originalOrigin = process.env.PUBLIC_APP_ORIGIN;

afterEach(() => {
  if (originalOrigin === undefined) {
    delete process.env.PUBLIC_APP_ORIGIN;
  } else {
    process.env.PUBLIC_APP_ORIGIN = originalOrigin;
  }
});

describe("authenticateRequest", () => {
  it("authenticates and consumes a bodyless NIP-98 request", async () => {
    process.env.PUBLIC_APP_ORIGIN = "https://buzzrouter.com";
    const url = "https://buzzrouter.com/api/shared-channels";
    const event = finalizeEvent(
      {
        content: "",
        created_at: Math.floor(Date.now() / 1_000),
        kind: 27_235,
        tags: [
          ["u", url],
          ["method", "GET"],
        ],
      },
      generateSecretKey(),
    );
    const query = vi.fn().mockResolvedValue({ rows: [{ id: event.id }] });
    const request = new Request(
      "http://internal-host/api/shared-channels",
      {
        headers: {
          authorization: `Nostr ${Buffer.from(
            JSON.stringify(event),
          ).toString("base64")}`,
        },
      },
    );

    await expect(
      authenticateRequest(request, { query } as unknown as Pool),
    ).resolves.toMatchObject({
      eventId: event.id,
      pubkey: event.pubkey,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO nostr_auth_events"),
      expect.arrayContaining([event.id, url, "GET"]),
    );
  });
});
