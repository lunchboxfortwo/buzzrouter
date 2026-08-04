import { afterEach, describe, expect, it, vi } from "vitest";

import type { PresenceMessage } from "./reader";
import {
  buildCommunitySummary,
  computeActivityMetrics,
  deriveActivityLevel,
  messagesInWindow,
  parseBlurb,
  summarizeMessages,
} from "./summarize";

const NOW = 1_800_000_000;
const DAY = 86_400;

function message(
  overrides: Partial<PresenceMessage> & { pubkey: string },
): PresenceMessage {
  return {
    channelId: overrides.channelId ?? "channel-1",
    content: overrides.content ?? "hello",
    createdAt: overrides.createdAt ?? NOW,
    id: overrides.id ?? Math.random().toString(36).slice(2),
    pubkey: overrides.pubkey,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function completion(content: string): Response {
  return json({ choices: [{ message: { content } }] });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("computeActivityMetrics", () => {
  it("counts distinct active members, messages, and channels in the window", () => {
    const messages = [
      message({ channelId: "a", pubkey: "alice" }),
      message({ channelId: "a", pubkey: "bob" }),
      message({ channelId: "b", pubkey: "alice" }),
      message({ channelId: "b", pubkey: "carol" }),
    ];
    const metrics = computeActivityMetrics(messages, { now: NOW });
    expect(metrics.activeMemberCount).toBe(3); // alice, bob, carol
    expect(metrics.messageCount).toBe(4);
    expect(metrics.channelCount).toBe(2); // a, b
    expect(metrics.windowDays).toBe(7);
  });

  it("excludes messages older than the window", () => {
    const messages = [
      message({ createdAt: NOW, pubkey: "alice" }),
      message({ createdAt: NOW - 3 * DAY, pubkey: "bob" }),
      message({ createdAt: NOW - 10 * DAY, pubkey: "carol" }), // out
    ];
    const metrics = computeActivityMetrics(messages, { now: NOW });
    expect(metrics.messageCount).toBe(2);
    expect(metrics.activeMemberCount).toBe(2);
  });

  it("honors a custom windowDays", () => {
    const messages = [
      message({ createdAt: NOW, pubkey: "alice" }),
      message({ createdAt: NOW - 5 * DAY, pubkey: "bob" }),
    ];
    expect(
      computeActivityMetrics(messages, { now: NOW, windowDays: 1 })
        .messageCount,
    ).toBe(1);
    expect(
      computeActivityMetrics(messages, { now: NOW, windowDays: 30 })
        .messageCount,
    ).toBe(2);
  });
});

describe("messagesInWindow", () => {
  it("filters to the trailing window", () => {
    const messages = [
      message({ createdAt: NOW, pubkey: "a" }),
      message({ createdAt: NOW - 8 * DAY, pubkey: "b" }),
    ];
    expect(messagesInWindow(messages, { now: NOW })).toHaveLength(1);
  });
});

describe("deriveActivityLevel", () => {
  it("maps volume and members to a level", () => {
    expect(deriveActivityLevel(0, 0)).toBe("quiet");
    expect(deriveActivityLevel(3, 2)).toBe("light");
    expect(deriveActivityLevel(40, 1)).toBe("light"); // single member
    expect(deriveActivityLevel(20, 4)).toBe("active");
    expect(deriveActivityLevel(60, 8)).toBe("busy");
    expect(deriveActivityLevel(60, 3)).toBe("active"); // volume up, few members
  });
});

describe("parseBlurb", () => {
  it("parses a clean JSON object", () => {
    expect(
      parseBlurb('{"goals":"Build things","recentProjects":["A","B"]}'),
    ).toEqual({
      focus: null,
      goals: "Build things",
      recentProjects: ["A", "B"],
      tagline: null,
    });
  });

  it("extracts JSON embedded in prose / code fences", () => {
    const text = 'Sure!\n```json\n{"goals":"G","recentProjects":["X"]}\n```';
    expect(parseBlurb(text)).toEqual({
      focus: null,
      goals: "G",
      recentProjects: ["X"],
      tagline: null,
    });
  });

  it("falls back to raw text when not JSON", () => {
    expect(parseBlurb("A friendly builders community.")).toEqual({
      focus: null,
      goals: "A friendly builders community.",
      recentProjects: [],
      tagline: null,
    });
  });

  it("returns an empty blurb when valid JSON carries no usable goals", () => {
    // The model echoed the field NAMES as values under empty keys; this parses
    // (last key wins) but has no `goals`. It must never become the profile.
    expect(
      parseBlurb('{"": "goals", "": "tagline", "": "recentProjects", "": "focus"}'),
    ).toEqual({
      focus: null,
      goals: "",
      recentProjects: [],
      tagline: null,
    });
  });

  it("drops non-string project entries", () => {
    expect(
      parseBlurb('{"goals":"G","recentProjects":["A",1,null,"B"]}'),
    ).toEqual({
      focus: null,
      goals: "G",
      recentProjects: ["A", "B"],
      tagline: null,
    });
  });

  it("normalizes a tagline: trims, collapses space, drops a trailing period", () => {
    expect(
      parseBlurb('{"goals":"G","recentProjects":[],"tagline":"  Vim  fans  in Japan. "}')
        .tagline,
    ).toBe("Vim fans in Japan");
  });

  it("clips an over-long tagline to a whole word within the budget", () => {
    const long = "Privacy-first Monero builders operators and researchers worldwide";
    const out = parseBlurb(
      `{"goals":"G","recentProjects":[],"tagline":${JSON.stringify(long)}}`,
    ).tagline;
    expect(out).not.toBeNull();
    expect((out as string).length).toBeLessThanOrEqual(42);
    expect(long.startsWith(out as string)).toBe(true); // cut on a word boundary
  });

  it("keeps a focus that is a known vocabulary slug", () => {
    expect(
      parseBlurb(
        '{"goals":"G","recentProjects":[],"focus":"bitcoin-money"}',
      ).focus,
    ).toBe("bitcoin-money");
  });

  it("coerces an unknown or malformed focus to null", () => {
    expect(
      parseBlurb('{"goals":"G","recentProjects":[],"focus":"crypto-bros"}')
        .focus,
    ).toBeNull();
    expect(
      parseBlurb('{"goals":"G","recentProjects":[],"focus":42}').focus,
    ).toBeNull();
  });
});

describe("summarizeMessages", () => {
  const messages = [
    message({ channelId: "general", content: "shipping v2", pubkey: "PUBKEY_ALICE" }),
    message({ channelId: "dev", content: "fixed the relay", pubkey: "PUBKEY_BOB" }),
  ];

  it("throws a clear error when the API key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    await expect(summarizeMessages(messages, {})).rejects.toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  it("strips pubkeys from the outbound prompt", async () => {
    const fetchImpl = vi.fn(async () =>
      completion('{"goals":"G","recentProjects":[]}'),
    );
    await summarizeMessages(messages, {
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    const body = init.body as string;
    expect(body).not.toContain("PUBKEY_ALICE");
    expect(body).not.toContain("PUBKEY_BOB");
    // Content and channel DO travel to the model.
    expect(body).toContain("shipping v2");
    expect(body).toContain("general");
  });

  it("sends model + bearer auth to OpenRouter", async () => {
    const fetchImpl = vi.fn(async () =>
      completion('{"goals":"G","recentProjects":["A"]}'),
    );
    await summarizeMessages(messages, {
      apiKey: "secret-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      model: "custom/model",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-key");
    expect(JSON.parse(init.body as string).model).toBe("custom/model");
  });

  it("builds the endpoint from OPENROUTER_BASE_URL when set", async () => {
    const fetchImpl = vi.fn(async () =>
      completion('{"goals":"G","recentProjects":[]}'),
    );
    vi.stubEnv("OPENROUTER_BASE_URL", "https://proxy.example");
    await summarizeMessages(messages, {
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proxy.example/api/v1/chat/completions");
  });

  it("prefers an explicit baseUrl over the env and default", async () => {
    const fetchImpl = vi.fn(async () =>
      completion('{"goals":"G","recentProjects":[]}'),
    );
    vi.stubEnv("OPENROUTER_BASE_URL", "https://env.example");
    await summarizeMessages(messages, {
      apiKey: "k",
      baseUrl: "https://explicit.example",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://explicit.example/api/v1/chat/completions");
  });

  it("defaults the model from OPENROUTER_MODEL then the built-in", async () => {
    const fetchImpl = vi.fn(async () =>
      completion('{"goals":"G","recentProjects":[]}'),
    );
    vi.stubEnv("OPENROUTER_MODEL", "env/model");
    await summarizeMessages(messages, {
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(init.body as string).model).toBe("env/model");
  });

  it("parses a valid response and a malformed one via fallback", async () => {
    const valid = vi.fn(async () =>
      completion('{"goals":"Ship","recentProjects":["A","B"]}'),
    );
    expect(
      await summarizeMessages(messages, {
        apiKey: "k",
        fetchImpl: valid as unknown as typeof fetch,
      }),
    ).toEqual({
      focus: null,
      goals: "Ship",
      recentProjects: ["A", "B"],
      tagline: null,
    });

    const malformed = vi.fn(async () => completion("totally not json"));
    expect(
      await summarizeMessages(messages, {
        apiKey: "k",
        fetchImpl: malformed as unknown as typeof fetch,
      }),
    ).toEqual({
      focus: null,
      goals: "totally not json",
      recentProjects: [],
      tagline: null,
    });
  });

  it("throws on a non-OK OpenRouter response", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "x" }, 500));
    await expect(
      summarizeMessages(messages, {
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("buildCommunitySummary", () => {
  it("merges deterministic metrics with the LLM blurb", async () => {
    const messages = [
      message({ channelId: "a", pubkey: "alice" }),
      message({ channelId: "b", pubkey: "bob" }),
    ];
    const fetchImpl = vi.fn(async () =>
      completion(
        '{"goals":"A builder guild","recentProjects":["Relay work"],' +
          '"focus":"building","tagline":"Builder guild HQ"}',
      ),
    );
    const summary = await buildCommunitySummary(messages, {
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
      totalMemberCount: 42,
    });
    expect(summary).toEqual({
      activeMemberCount: 2,
      activityLevel: "light",
      channelCount: 2,
      focus: "building",
      goals: "A builder guild",
      messageCount: 2,
      recentProjects: ["Relay work"],
      tagline: "Builder guild HQ",
      totalMemberCount: 42,
      windowDays: 7,
    });
  });

  it("omits totalMemberCount when not supplied", async () => {
    const fetchImpl = vi.fn(async () =>
      completion('{"goals":"G","recentProjects":[]}'),
    );
    const summary = await buildCommunitySummary(
      [message({ pubkey: "alice" })],
      {
        apiKey: "k",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: NOW,
      },
    );
    expect(summary.totalMemberCount).toBeUndefined();
    expect("totalMemberCount" in summary).toBe(false);
  });
});
