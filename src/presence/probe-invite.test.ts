import { generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import { probeInvite } from "./probe-invite";

const secret = generateSecretKey();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes a mock fetch by URL path so the policy handshake can be exercised. */
function router(handlers: Record<string, () => Response>): {
  fetchImpl: typeof fetch;
  hits: string[];
} {
  const hits: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url).pathname;
    hits.push(path);
    const handler = handlers[path];
    if (!handler) throw new Error(`unexpected fetch to ${path}`);
    return handler();
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, hits };
}

describe("probeInvite", () => {
  it("classifies a 200 already_member as live", async () => {
    const fetchImpl = vi.fn(async () => json({ status: "already_member" }));
    await expect(
      probeInvite({
        code: "abc",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("live");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("classifies 403 invite_expired as expired", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "invite_expired" }, 403));
    await expect(
      probeInvite({
        code: "abc",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("expired");
  });

  it("classifies 403 invite_invalid as invalid", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "invite_invalid" }, 403));
    await expect(
      probeInvite({
        code: "abc",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("invalid");
  });

  it("classifies 403 invite_exhausted as exhausted", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "invite_exhausted" }, 403),
    );
    await expect(
      probeInvite({
        code: "abc",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("exhausted");
  });

  it("accepts the join policy then retries the claim for a policy-gated host", async () => {
    let claimCalls = 0;
    const { fetchImpl, hits } = router({
      "/api/invites/accept-policy": () => json({ receipt: "receipt-token" }),
      "/api/invites/claim": () => {
        claimCalls += 1;
        return claimCalls === 1
          ? json({ error: "join_policy_required" }, 403)
          : json({ status: "joined" });
      },
      "/api/join-policy": () => json({ policy: { version: "v1" } }),
    });

    await expect(
      probeInvite({
        code: "abc",
        fetchImpl,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("live");
    expect(hits).toEqual([
      "/api/invites/claim",
      "/api/join-policy",
      "/api/invites/accept-policy",
      "/api/invites/claim",
    ]);
  });

  it("returns error on a network failure without throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    await expect(
      probeInvite({
        code: "abc",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("error");
  });

  it("returns error for an unrecognized 403 rather than swapping", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "unauthorized" }, 403));
    await expect(
      probeInvite({
        code: "abc",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("error");
  });

  it("returns error when the policy acceptance is rejected", async () => {
    const { fetchImpl } = router({
      "/api/invites/accept-policy": () => json({ error: "nope" }, 400),
      "/api/invites/claim": () => json({ error: "join_policy_required" }, 403),
      "/api/join-policy": () => json({ policy: { version: "v1" } }),
    });
    await expect(
      probeInvite({
        code: "abc",
        fetchImpl,
        host: "relay.example",
        privateKey: secret,
      }),
    ).resolves.toBe("error");
  });
});
