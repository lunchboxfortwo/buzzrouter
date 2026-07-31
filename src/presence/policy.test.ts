import { createHash } from "node:crypto";

import type { Event } from "nostr-tools/core";
import { generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import {
  acceptJoinPolicy,
  acceptPolicyEndpoint,
  getJoinPolicy,
  isJoinPolicyRequired,
  joinCommunity,
  joinPolicyEndpoint,
} from "./policy";

const secret = generateSecretKey();

function decodeHeader(header: string): Event {
  expect(header.startsWith("Nostr ")).toBe(true);
  const json = Buffer.from(header.slice(6), "base64").toString("utf8");
  return JSON.parse(json) as Event;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("endpoints", () => {
  it("build public and authorized policy URLs from a host", () => {
    expect(joinPolicyEndpoint("wss://relay.example.com/")).toBe(
      "https://relay.example.com/api/join-policy",
    );
    expect(acceptPolicyEndpoint("relay.example.com")).toBe(
      "https://relay.example.com/api/invites/accept-policy",
    );
  });
});

describe("isJoinPolicyRequired", () => {
  it("detects the join_policy_required signal", () => {
    expect(isJoinPolicyRequired({ error: "join_policy_required" })).toBe(
      true,
    );
    expect(isJoinPolicyRequired({ error: "forbidden" })).toBe(false);
    expect(isJoinPolicyRequired("nope")).toBe(false);
    expect(isJoinPolicyRequired(null)).toBe(false);
  });
});

describe("getJoinPolicy", () => {
  it("parses the policy payload", async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        policy: {
          age_attestation_required: true,
          privacy_markdown: "# Privacy",
          terms_markdown: "# Terms",
          version: "deadbeef",
        },
      }),
    );
    const policy = await getJoinPolicy(
      "relay.example.com",
      fetchImpl as unknown as typeof fetch,
    );
    expect(policy).toEqual({
      ageAttestationRequired: true,
      privacyMarkdown: "# Privacy",
      termsMarkdown: "# Terms",
      version: "deadbeef",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://relay.example.com/api/join-policy");
    expect(init.method).toBe("GET");
  });

  it("throws on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => json({}, 500));
    await expect(
      getJoinPolicy(
        "relay.example.com",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/HTTP 500/);
  });

  it("throws on a malformed payload", async () => {
    const fetchImpl = vi.fn(async () => json({ policy: {} }));
    await expect(
      getJoinPolicy(
        "relay.example.com",
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/Malformed/);
  });
});

describe("acceptJoinPolicy", () => {
  it("signs, posts the accept body, and returns the receipt", async () => {
    const fetchImpl = vi.fn(async () => json({ receipt: "receipt-token" }));
    const result = await acceptJoinPolicy({
      ageConfirmed: true,
      code: "abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host: "relay.example.com",
      policyVersion: "deadbeef",
      privateKey: secret,
    });
    expect(result).toEqual({ ok: true, receipt: "receipt-token" });

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://relay.example.com/api/invites/accept-policy");
    const body = init.body as string;
    expect(JSON.parse(body)).toEqual({
      age_confirmed: true,
      code: "abc123",
      policy_version: "deadbeef",
    });
    // NIP-98 header signs the exact body string that is sent.
    const headers = init.headers as Record<string, string>;
    const event = decodeHeader(headers.authorization);
    expect(verifyEvent(event)).toBe(true);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
  });

  it("classifies a rejection body", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "policy_version_stale" }, 409),
    );
    const result = await acceptJoinPolicy({
      ageConfirmed: true,
      code: "abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host: "relay.example.com",
      policyVersion: "old",
      privateKey: secret,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "policy_version_stale",
      status: 409,
    });
  });

  it("surfaces network failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const result = await acceptJoinPolicy({
      ageConfirmed: true,
      code: "abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host: "relay.example.com",
      policyVersion: "v",
      privateKey: secret,
    });
    expect(result).toMatchObject({ ok: false, status: 0 });
  });
});

/** Routes a mock fetch by URL path so joinCommunity can be exercised end-to-end. */
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

describe("joinCommunity", () => {
  it("returns the joined body when no policy is configured", async () => {
    const joined = { community_id: "c1", host: "h", role: "member", status: "joined" };
    const { fetchImpl, hits } = router({
      "/api/invites/claim": () => json(joined),
    });
    const result = await joinCommunity({
      acceptTerms: false,
      code: "abc123",
      fetchImpl,
      host: "relay.example.com",
      privateKey: secret,
    });
    expect(result).toEqual({ body: joined, ok: true, status: 200 });
    expect(hits).toEqual(["/api/invites/claim"]);
  });

  it("refuses to accept terms without --accept-terms and does NOT hit accept-policy", async () => {
    const { fetchImpl, hits } = router({
      "/api/invites/claim": () =>
        json({ error: "join_policy_required" }, 403),
    });
    const result = await joinCommunity({
      acceptTerms: false,
      code: "abc123",
      fetchImpl,
      host: "relay.example.com",
      privateKey: secret,
    });
    expect(result).toEqual({ ok: false, reason: "terms_required" });
    expect(hits).toEqual(["/api/invites/claim"]);
    expect(hits).not.toContain("/api/invites/accept-policy");
    expect(hits).not.toContain("/api/join-policy");
  });

  it("runs the full handshake with acceptTerms and presents the receipt", async () => {
    const joined = { community_id: "c1", host: "h", role: "member", status: "joined" };
    let claimCalls = 0;
    const claimBodies: string[] = [];
    const hits: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const path = new URL(url).pathname;
      hits.push(path);
      if (path === "/api/invites/claim") {
        claimCalls += 1;
        claimBodies.push(init?.body as string);
        if (claimCalls === 1) {
          return json({ error: "join_policy_required" }, 403);
        }
        return json(joined);
      }
      if (path === "/api/join-policy") {
        return json({
          policy: { age_attestation_required: true, version: "deadbeef" },
        });
      }
      if (path === "/api/invites/accept-policy") {
        return json({ receipt: "receipt-token" });
      }
      throw new Error(`unexpected ${path}`);
    });

    const result = await joinCommunity({
      acceptTerms: true,
      code: "abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host: "relay.example.com",
      privateKey: secret,
    });

    expect(result).toEqual({ body: joined, ok: true, status: 200 });
    expect(hits).toEqual([
      "/api/invites/claim",
      "/api/join-policy",
      "/api/invites/accept-policy",
      "/api/invites/claim",
    ]);
    // First claim had no receipt; retried claim carries the policy receipt.
    expect(JSON.parse(claimBodies[0])).toEqual({ code: "abc123" });
    expect(JSON.parse(claimBodies[1])).toEqual({
      code: "abc123",
      policy_receipt: "receipt-token",
    });
  });

  it("invokes onJoined with the host and community id on a bare join", async () => {
    const joined = { community_id: "c1", host: "h", status: "joined" };
    const { fetchImpl } = router({
      "/api/invites/claim": () => json(joined),
    });
    const onJoined = vi.fn();
    await joinCommunity({
      acceptTerms: false,
      code: "abc123",
      fetchImpl,
      host: "relay.example.com",
      onJoined,
      privateKey: secret,
    });
    expect(onJoined).toHaveBeenCalledWith({
      communityId: "c1",
      host: "relay.example.com",
    });
  });

  it("invokes onJoined after the policy handshake completes the join", async () => {
    const joined = { community_id: "c9", status: "joined" };
    let claimCalls = 0;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const path = new URL(
        typeof input === "string" ? input : input.toString(),
      ).pathname;
      if (path === "/api/invites/claim") {
        claimCalls += 1;
        return claimCalls === 1
          ? json({ error: "join_policy_required" }, 403)
          : json(joined);
      }
      if (path === "/api/join-policy") {
        return json({ policy: { version: "v" } });
      }
      return json({ receipt: "receipt-token" });
    });
    const onJoined = vi.fn();
    await joinCommunity({
      acceptTerms: true,
      code: "abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host: "relay.example.com",
      onJoined,
      privateKey: secret,
    });
    expect(onJoined).toHaveBeenCalledTimes(1);
    expect(onJoined).toHaveBeenCalledWith({
      communityId: "c9",
      host: "relay.example.com",
    });
  });

  it("does not invoke onJoined and does not fail the join on a rejected claim", async () => {
    const { fetchImpl } = router({
      "/api/invites/claim": () => json({ error: "gone" }, 410),
    });
    const onJoined = vi.fn();
    const result = await joinCommunity({
      acceptTerms: true,
      code: "abc123",
      fetchImpl,
      host: "relay.example.com",
      onJoined,
      privateKey: secret,
    });
    expect(result.ok).toBe(false);
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("swallows an onJoined error so bookkeeping never fails a real join", async () => {
    const joined = { community_id: "c1", status: "joined" };
    const { fetchImpl } = router({
      "/api/invites/claim": () => json(joined),
    });
    const result = await joinCommunity({
      acceptTerms: false,
      code: "abc123",
      fetchImpl,
      host: "relay.example.com",
      onJoined: () => {
        throw new Error("db down");
      },
      privateKey: secret,
    });
    expect(result).toEqual({ body: joined, ok: true, status: 200 });
  });

  it("passes through non-policy claim failures", async () => {
    const { fetchImpl } = router({
      "/api/invites/claim": () => json({ error: "gone" }, 410),
    });
    const result = await joinCommunity({
      acceptTerms: true,
      code: "abc123",
      fetchImpl,
      host: "relay.example.com",
      privateKey: secret,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "expired",
      status: 410,
    });
  });

  it("reports policy_accept_failed when accept-policy rejects", async () => {
    const { fetchImpl } = router({
      "/api/invites/claim": () =>
        json({ error: "join_policy_required" }, 403),
      "/api/join-policy": () =>
        json({ policy: { age_attestation_required: true, version: "v" } }),
      "/api/invites/accept-policy": () => json({ error: "nope" }, 400),
    });
    const result = await joinCommunity({
      acceptTerms: true,
      code: "abc123",
      fetchImpl,
      host: "relay.example.com",
      privateKey: secret,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "policy_accept_failed",
      status: 400,
    });
  });
});
