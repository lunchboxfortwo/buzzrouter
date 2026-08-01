import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db/pool", () => ({
  getDatabasePool: () => "pool",
}));

const getCandidateInviteTarget = vi.fn();
vi.mock("../../../src/db/join-probes", () => ({
  getCandidateInviteTarget: (...args: unknown[]) =>
    getCandidateInviteTarget(...args),
}));

const getJoinPolicy = vi.fn();
const acceptJoinPolicy = vi.fn();
vi.mock("../../../src/presence/policy", () => ({
  acceptJoinPolicy: (...args: unknown[]) => acceptJoinPolicy(...args),
  getJoinPolicy: (...args: unknown[]) => getJoinPolicy(...args),
}));

const CANDIDATE = "11111111-1111-4111-8111-111111111111";
const TARGET = {
  candidateId: CANDIDATE,
  canonicalRelayUrl: "wss://relay.example",
  code: "code-1",
  host: "relay.example",
};

function post(body: unknown): Request {
  return new Request("https://buzzrouter.com/api/invite-receipt", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  getCandidateInviteTarget.mockResolvedValue(TARGET);
  getJoinPolicy.mockResolvedValue({
    ageAttestationRequired: true,
    version: "v1",
  });
  acceptJoinPolicy.mockResolvedValue({ ok: true, receipt: "RECEIPT-XYZ" });
});

describe("POST /api/invite-receipt", () => {
  it("mints a receipt when a human confirms the age/ToS gate", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      post({ ageConfirmed: true, candidateId: CANDIDATE, policyVersion: "v1" }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      code: "code-1",
      policyVersion: "v1",
      receipt: "RECEIPT-XYZ",
      relayUrl: "wss://relay.example",
    });
    // Consent is passed through verbatim — never defaulted.
    expect(acceptJoinPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ ageConfirmed: true, code: "code-1", policyVersion: "v1" }),
    );
  });

  it("REFUSES to mint when the policy needs an age attestation the caller did not give", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      post({ ageConfirmed: false, candidateId: CANDIDATE, policyVersion: "v1" }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("age_confirmation_required");
    expect(acceptJoinPolicy).not.toHaveBeenCalled();
  });

  it("returns 409 when the policy version drifted since the user reviewed it", async () => {
    getJoinPolicy.mockResolvedValue({ ageAttestationRequired: true, version: "v2" });
    const { POST } = await import("./route");
    const response = await POST(
      post({ ageConfirmed: true, candidateId: CANDIDATE, policyVersion: "v1" }),
    );

    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("policy_changed");
    expect(acceptJoinPolicy).not.toHaveBeenCalled();
  });

  it("mints without an age tick when the policy does not require one", async () => {
    getJoinPolicy.mockResolvedValue({ ageAttestationRequired: false, version: "v1" });
    const { POST } = await import("./route");
    const response = await POST(
      post({ ageConfirmed: false, candidateId: CANDIDATE, policyVersion: "v1" }),
    );

    expect(response.status).toBe(200);
    expect(acceptJoinPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ ageConfirmed: false }),
    );
  });

  it("404s when we hold no invite for the candidate", async () => {
    getCandidateInviteTarget.mockResolvedValue(null);
    const { POST } = await import("./route");
    const response = await POST(
      post({ ageConfirmed: true, candidateId: CANDIDATE, policyVersion: "v1" }),
    );

    expect(response.status).toBe(404);
    expect((await response.json()).error).toBe("no_invite");
  });

  it("rejects a non-uuid candidate id without touching the relay", async () => {
    const { POST } = await import("./route");
    const response = await POST(
      post({ ageConfirmed: true, candidateId: "../etc", policyVersion: "v1" }),
    );

    expect(response.status).toBe(400);
    expect(getCandidateInviteTarget).not.toHaveBeenCalled();
    expect(getJoinPolicy).not.toHaveBeenCalled();
  });

  it("surfaces an accept-policy failure as 502 rather than a partial success", async () => {
    acceptJoinPolicy.mockResolvedValue({ ok: false, reason: "boom", status: 500 });
    const { POST } = await import("./route");
    const response = await POST(
      post({ ageConfirmed: true, candidateId: CANDIDATE, policyVersion: "v1" }),
    );

    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe("accept_policy_failed");
  });
});
