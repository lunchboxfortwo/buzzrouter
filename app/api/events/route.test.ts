import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/db/pool", () => ({ getDatabasePool: () => ({}) }));
vi.mock("../../../src/db/funnel", () => ({ recordFunnelEvent: vi.fn() }));

import { recordFunnelEvent } from "../../../src/db/funnel";
import { resetEventRateLimitState } from "../../../src/http/rate-limit";
import { POST } from "./route";

const ORIGIN = "https://buzzrouter.com";

function beacon(
  body: unknown,
  { origin = ORIGIN, ip = "1.2.3.4", ua = "Mozilla/5.0" } = {},
): Request {
  return new Request(`${ORIGIN}/api/events`, {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      "cf-connecting-ip": ip,
      "content-type": "application/json",
      origin,
      "user-agent": ua,
    },
    method: "POST",
  });
}

describe("POST /api/events", () => {
  beforeEach(() => {
    resetEventRateLimitState();
    vi.stubEnv("PUBLIC_APP_ORIGIN", ORIGIN);
    vi.mocked(recordFunnelEvent).mockReset();
    vi.mocked(recordFunnelEvent).mockResolvedValue(undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("rejects a cross-origin beacon without recording", async () => {
    const res = await POST(
      beacon(
        { affordance: "row_join", event_type: "join_click", host: "x.buzz" },
        { origin: "https://attacker.example" },
      ),
    );
    expect(res.status).toBe(403);
    expect(recordFunnelEvent).not.toHaveBeenCalled();
  });

  it("records a valid click with the device derived server-side from the UA", async () => {
    const res = await POST(
      beacon(
        {
          affordance: "invite_join",
          candidateId: "11111111-1111-1111-1111-111111111111",
          event_type: "join_click",
          host: "creatormagic.communities.buzz.xyz",
          session_id: "sess-abc",
        },
        { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" },
      ),
    );
    expect(res.status).toBe(204);
    expect(recordFunnelEvent).toHaveBeenCalledOnce();
    expect(vi.mocked(recordFunnelEvent).mock.calls[0]?.[1]).toMatchObject({
      affordance: "invite_join",
      candidateId: "11111111-1111-1111-1111-111111111111",
      device: "mobile",
      eventType: "join_click",
      host: "creatormagic.communities.buzz.xyz",
      sessionId: "sess-abc",
    });
  });

  it("nulls an unknown affordance and a non-uuid candidate but still records", async () => {
    await POST(
      beacon({
        affordance: "bogus",
        candidateId: "not-a-uuid",
        event_type: "join_click",
        host: "h",
      }),
    );
    expect(vi.mocked(recordFunnelEvent).mock.calls[0]?.[1]).toMatchObject({
      affordance: null,
      candidateId: null,
      device: "desktop",
      host: "h",
    });
  });

  it("rejects an unknown event type", async () => {
    const res = await POST(beacon({ event_type: "pageview", host: "h" }));
    expect(res.status).toBe(400);
    expect(recordFunnelEvent).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON body", async () => {
    expect((await POST(beacon("not json{"))).status).toBe(400);
  });

  it("throttles a flooding IP after the per-minute allowance", async () => {
    const payload = { affordance: "row_join", event_type: "join_click", host: "h" };
    for (let i = 0; i < 60; i += 1) {
      expect((await POST(beacon(payload, { ip: "9.9.9.9" }))).status).toBe(204);
    }
    expect((await POST(beacon(payload, { ip: "9.9.9.9" }))).status).toBe(429);
    // A different IP is unaffected.
    expect((await POST(beacon(payload, { ip: "8.8.8.8" }))).status).toBe(204);
  });
});
