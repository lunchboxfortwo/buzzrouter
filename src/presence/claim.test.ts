import { createHash } from "node:crypto";

import type { Event } from "nostr-tools/core";
import { generateSecretKey, verifyEvent } from "nostr-tools/pure";
import { describe, expect, it, vi } from "vitest";

import {
  buildNip98Header,
  claimEndpoint,
  claimInvite,
  classifyClaimResponse,
} from "./claim";

const secret = generateSecretKey();

function decodeHeader(header: string): Event {
  expect(header.startsWith("Nostr ")).toBe(true);
  const json = Buffer.from(header.slice(6), "base64").toString("utf8");
  return JSON.parse(json) as Event;
}

describe("claimEndpoint", () => {
  it("normalizes hosts and schemes", () => {
    expect(claimEndpoint("relay.example.com")).toBe(
      "https://relay.example.com/api/invites/claim",
    );
    expect(claimEndpoint("wss://relay.example.com/")).toBe(
      "https://relay.example.com/api/invites/claim",
    );
    expect(claimEndpoint("https://relay.example.com")).toBe(
      "https://relay.example.com/api/invites/claim",
    );
  });
});

describe("buildNip98Header", () => {
  const url = "https://relay.example.com/api/invites/claim";
  const body = JSON.stringify({ code: "abc123" });

  it("builds a valid, signed kind:27235 event with a payload hash", () => {
    const header = buildNip98Header({
      body,
      method: "post",
      privateKey: secret,
      url,
    });
    const event = decodeHeader(header);

    expect(event.kind).toBe(27_235);
    expect(event.content).toBe("");
    expect(verifyEvent(event)).toBe(true);
    expect(event.tags).toContainEqual(["u", url]);
    expect(event.tags).toContainEqual(["method", "POST"]);
    expect(event.tags).toContainEqual([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
    expect(event.tags.some((tag) => tag[0] === "nonce")).toBe(true);
  });

  it("omits the payload tag when there is no body", () => {
    const event = decodeHeader(
      buildNip98Header({ method: "GET", privateKey: secret, url }),
    );
    expect(event.tags.some((tag) => tag[0] === "payload")).toBe(false);
  });
});

describe("classifyClaimResponse", () => {
  it("classifies success", () => {
    expect(classifyClaimResponse(200, { joined: true })).toEqual({
      body: { joined: true },
      ok: true,
      status: 200,
    });
  });

  it("distinguishes auth, forbidden, and not-found failures", () => {
    expect(classifyClaimResponse(401, {})).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    expect(classifyClaimResponse(403, {})).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    expect(classifyClaimResponse(404, {})).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("distinguishes expired from invalid", () => {
    expect(classifyClaimResponse(410, {})).toMatchObject({
      reason: "expired",
    });
    expect(
      classifyClaimResponse(409, { reason: "invite already used" }),
    ).toMatchObject({ reason: "invalid" });
    expect(
      classifyClaimResponse(400, { error: "This invite has expired" }),
    ).toMatchObject({ reason: "expired" });
  });

  it("classifies rate limiting and server errors", () => {
    expect(classifyClaimResponse(429, {})).toMatchObject({
      reason: "rate_limited",
    });
    expect(classifyClaimResponse(503, {})).toMatchObject({
      reason: "server_error",
    });
  });
});

describe("claimInvite", () => {
  it("signs, posts, and classifies a successful claim", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ joined: true }), { status: 200 }),
    );
    const result = await claimInvite({
      code: "abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host: "relay.example.com",
      privateKey: secret,
    });

    expect(result).toMatchObject({ ok: true, status: 200 });
    const [calledUrl, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe(
      "https://relay.example.com/api/invites/claim",
    );
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    const event = decodeHeader(headers.authorization);
    expect(verifyEvent(event)).toBe(true);
    expect(init.body).toBe(JSON.stringify({ code: "abc123" }));
  });

  it("surfaces network failures as network_error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const result = await claimInvite({
      code: "abc123",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      host: "relay.example.com",
      privateKey: secret,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: "network_error",
      status: 0,
    });
  });
});
