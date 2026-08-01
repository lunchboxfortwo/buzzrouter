import { generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import { probeJoinability } from "./joinability";

const POLICY_PATH = "/api/join-policy";
const CLAIM_PATH = "/api/invites/claim";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

/** Routes a mock fetch by URL path so the policy-read + claim can be scripted. */
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

const OPEN_POLICY = { policy: { age_attestation_required: false, version: "v0" } };
const GATED_POLICY = { policy: { age_attestation_required: true, version: "v1" } };
const key = generateSecretKey();

function probe(fetchImpl: typeof fetch) {
  return probeJoinability({
    code: "code-1",
    ephemeralKey: key,
    fetchImpl,
    host: "relay.example",
  });
}

describe("probeJoinability", () => {
  it("classifies an age-gated community as policy_gated from the policy read ALONE — no claim", async () => {
    const { fetchImpl, hits } = router({
      [POLICY_PATH]: () => json(GATED_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toEqual({
      detail: "join_policy_required",
      status: "policy_gated",
    });
    // The cheap signal: it must NOT spend an invite claim on a gated community.
    expect(hits).toEqual([POLICY_PATH]);
  });

  it("classifies an un-gated community whose bare claim lands as open", async () => {
    const { fetchImpl, hits } = router({
      [CLAIM_PATH]: () => json({ status: "joined" }, 200),
      [POLICY_PATH]: () => json(OPEN_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toEqual({ status: "open" });
    expect(hits).toEqual([POLICY_PATH, CLAIM_PATH]);
  });

  it("classifies a bare-claim join_policy_required as policy_gated even if the policy read missed it", async () => {
    // Policy endpoint claims no age gate, but the claim still demands the ToS
    // handshake — the claim is authoritative.
    const { fetchImpl } = router({
      [CLAIM_PATH]: () => json({ error: "join_policy_required" }, 403),
      [POLICY_PATH]: () => json(OPEN_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toEqual({
      detail: "join_policy_required",
      status: "policy_gated",
    });
  });

  it("classifies an owner-only / allowlist refusal as restricted", async () => {
    const { fetchImpl } = router({
      [CLAIM_PATH]: () => json({ error: "not_a_member" }, 403),
      [POLICY_PATH]: () => json(OPEN_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toEqual({
      detail: "not_a_member",
      status: "restricted",
    });
  });

  it("classifies an expired code as stale", async () => {
    const { fetchImpl } = router({
      [CLAIM_PATH]: () => json({ error: "invite_expired" }, 403),
      [POLICY_PATH]: () => json(OPEN_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toMatchObject({ status: "stale" });
  });

  it("classifies an invalid code as stale", async () => {
    const { fetchImpl } = router({
      [CLAIM_PATH]: () => json({ error: "invite_invalid" }, 403),
      [POLICY_PATH]: () => json(OPEN_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toMatchObject({ status: "stale" });
  });

  it("reports a transport failure as unknown (never throws), withholding a verdict", async () => {
    const { fetchImpl } = router({
      [CLAIM_PATH]: () => json({}, 503),
      [POLICY_PATH]: () => json(OPEN_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toMatchObject({ status: "unknown" });
  });

  it("withholds a verdict (unknown) on a 401 rather than branding it restricted", async () => {
    // 401 = our NIP-98 signature was rejected — an our-side fault, not a closed
    // community; it must not read as owner-only.
    const { fetchImpl } = router({
      [CLAIM_PATH]: () => json({ error: "bad_signature" }, 401),
      [POLICY_PATH]: () => json(OPEN_POLICY),
    });

    await expect(probe(fetchImpl)).resolves.toMatchObject({ status: "unknown" });
  });

  it("falls back to the bare claim when the policy read is unavailable", async () => {
    const { fetchImpl, hits } = router({
      [CLAIM_PATH]: () => json({ status: "joined" }, 200),
      [POLICY_PATH]: () => json({}, 404),
    });

    await expect(probe(fetchImpl)).resolves.toEqual({ status: "open" });
    expect(hits).toEqual([POLICY_PATH, CLAIM_PATH]);
  });
});
