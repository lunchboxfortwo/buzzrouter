import { generateSecretKey, getPublicKey } from "nostr-tools/pure";
import type { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  alreadyRows: [] as { id: string }[],
  inviteTarget: {
    candidateId: "11111111-1111-4111-8111-111111111111",
    canonicalRelayUrl: "wss://relay.example.com/",
    code: "inv123",
    host: "relay.example.com",
  } as {
    candidateId: string;
    canonicalRelayUrl: string;
    code: string;
    host: string;
  } | null,
  community: null as {
    canonicalRelayUrl: string;
    displayName: string | null;
    inviteCode: string | null;
    relayHost: string;
  } | null,
  privateKey: new Uint8Array(32) as Uint8Array,
  pubkey: "",
  recordMembership: vi.fn(),
}));

vi.mock("../db/join-probes", () => ({
  getCandidateInviteTarget: vi.fn(async () => state.inviteTarget),
}));

vi.mock("../db/directory", () => ({
  getCommunityByHost: vi.fn(async () => state.community),
}));

vi.mock("./store", () => ({
  recordMembership: state.recordMembership,
  withIdentitySecret: vi.fn(
    async (
      _pool: unknown,
      _id: string,
      fn: (key: Buffer, pubkey: string) => Promise<unknown>,
    ) => fn(Buffer.from(state.privateKey), state.pubkey),
  ),
}));

import { joinCommunityWithManagedIdentity } from "./join";

const JOIN_INPUT = {
  ageConfirmed: true,
  candidateId: "11111111-1111-4111-8111-111111111111",
  identityId: "id-1",
  policyVersion: "v1",
};

function fakePool(): Pool {
  return {
    query: vi.fn(async () => ({ rows: state.alreadyRows })),
  } as unknown as Pool;
}

function jsonResponse(status: number, body: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), { headers, status });
}

beforeEach(() => {
  state.privateKey = generateSecretKey();
  state.pubkey = getPublicKey(state.privateKey);
  state.alreadyRows = [];
  state.inviteTarget = {
    candidateId: JOIN_INPUT.candidateId,
    canonicalRelayUrl: "wss://relay.example.com/",
    code: "inv123",
    host: "relay.example.com",
  };
  state.community = {
    canonicalRelayUrl: "wss://relay.example.com/",
    displayName: "Example Community",
    inviteCode: "inv123",
    relayHost: "relay.example.com",
  };
  state.recordMembership.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("joinCommunityWithManagedIdentity", () => {
  it("claims the invite and records membership on success", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, {
        community_id: "c-1",
        host: "relay.example.com",
        role: "member",
        status: "joined",
      }),
    );

    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );

    expect(outcome).toMatchObject({
      communityId: "c-1",
      role: "member",
      status: "joined",
    });
    expect(JSON.stringify(outcome)).not.toContain("policy-receipt");
    expect(state.recordMembership).toHaveBeenCalledTimes(1);

    // SSRF: the claim is pinned to the community's on-record relay over https,
    // signed with the managed key, carrying only the invite code.
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://relay.example.com/api/invites/claim");
    expect(init.body).toBe(JSON.stringify({ code: "inv123" }));
    expect(String((init.headers as Record<string, string>).authorization)).toMatch(
      /^Nostr /,
    );
  });

  it("accepts a required policy with the managed key and retries with its receipt", async () => {
    let claimAttempts = 0;
    let acceptPubkey = "";
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/join-policy")) {
        return jsonResponse(200, {
          policy: { age_attestation_required: true, version: "v1" },
        });
      }
      if (url.endsWith("/api/invites/accept-policy")) {
        expect(init?.body).toBe(
          JSON.stringify({
            age_confirmed: true,
            code: "inv123",
            policy_version: "v1",
          }),
        );
        acceptPubkey = nip98Pubkey(init);
        return jsonResponse(200, { receipt: "policy-receipt" });
      }
      if (url.endsWith("/api/invites/claim")) {
        claimAttempts += 1;
        if (claimAttempts === 1) {
          expect(init?.body).toBe(JSON.stringify({ code: "inv123" }));
          return jsonResponse(403, { error: "join_policy_required" });
        }
        expect(init?.body).toBe(
          JSON.stringify({ code: "inv123", policy_receipt: "policy-receipt" }),
        );
        expect(nip98Pubkey(init)).toBe(acceptPubkey);
        return jsonResponse(200, { community_id: "c-1", role: "member" });
      }
      return jsonResponse(404, {});
    });

    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );

    expect(outcome.status).toBe("joined");
    expect(claimAttempts).toBe(2);
    expect(state.recordMembership).toHaveBeenCalledTimes(1);
  });

  it("gives a generic refusal for a 403 without a known policy signal", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(403, {}));
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.reason).toBe("This community declined the join request.");
    }
  });

  it("reports rate limiting with the upstream retry-after", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(429, { error: "rate_limited" }, { "retry-after": "30" }),
    );
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome).toMatchObject({ retryAfterSeconds: 30, status: "rate_limited" });
  });

  it("reports 'unreachable' when the relay cannot be reached", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.status).toBe("unreachable");
  });

  it("reports a generic error for other non-ok statuses", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, {}));
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.status).toBe("error");
  });

  it("short-circuits an already-joined community without claiming again", async () => {
    state.alreadyRows = [{ id: "membership-1" }];
    const fetchImpl = vi.fn();
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.status).toBe("already_joined");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is not_joinable when the candidate no longer has an invite", async () => {
    state.inviteTarget = null;
    const fetchImpl = vi.fn();
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    expect(outcome.status).toBe("not_joinable");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("is not_joinable when the host is unknown to the directory", async () => {
    state.community = null;
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      (vi.fn() as unknown) as typeof fetch,
    );
    expect(outcome.status).toBe("not_joinable");
  });

  it("never leaks the secret key into the outcome payload", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { community_id: "c-1", role: "member" }),
    );
    const outcome = await joinCommunityWithManagedIdentity(
      fakePool(),
      JOIN_INPUT,
      undefined,
      fetchImpl as unknown as typeof fetch,
    );
    const secretHex = Buffer.from(state.privateKey).toString("hex");
    expect(JSON.stringify(outcome)).not.toContain(secretHex);
  });
});

function nip98Pubkey(init: RequestInit | undefined): string {
  const authorization = String(
    (init?.headers as Record<string, string> | undefined)?.authorization ?? "",
  );
  const encoded = authorization.replace(/^Nostr /, "");
  const event = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
    pubkey: string;
  };
  return event.pubkey;
}
