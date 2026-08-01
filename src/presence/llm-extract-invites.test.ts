import { afterEach, describe, expect, it, vi } from "vitest";

import { llmExtractInvites } from "./llm-extract-invites";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function completion(content: string): Response {
  return json({ choices: [{ message: { content } }] });
}

function messages(...contents: string[]): { content: string }[] {
  return contents.map((content) => ({ content }));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("llmExtractInvites", () => {
  it("skips the LLM entirely when nothing survives the pre-filter", async () => {
    const fetchImpl = vi.fn();
    // First message is not invite-ish; second is invite-ish but the regex
    // already catches it — both are excluded, so no call is made.
    const result = await llmExtractInvites(
      messages(
        "just chatting about the weather",
        "welcome! buzz://join?relay=wss://known.example&code=REG",
      ),
      { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("sends only invite-ish, regex-missed messages to the model", async () => {
    const fetchImpl = vi.fn(async () => completion('{"invites":[]}'));
    await llmExtractInvites(
      messages(
        "hello everyone", // not invite-ish → excluded
        "buzz://join?relay=wss://caught.example&code=HIT", // regex hit → excluded
        "join here: relay r.example code ABC-123", // invite-ish, regex miss → sent
      ),
      { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: { content: string; role: string }[];
    };
    const userContent = body.messages.find((m) => m.role === "user")?.content;
    expect(userContent).toContain("join here");
    expect(userContent).not.toContain("hello everyone");
    expect(userContent).not.toContain("caught.example");
  });

  it("forwards a worded invite the old invite/join filter would have dropped", async () => {
    // No 'invite'/'join'/scheme — only the word 'relay' + 'code'. The broadened
    // pre-filter now sends it to the model for recall.
    const fetchImpl = vi.fn(async () => completion('{"invites":[]}'));
    await llmExtractInvites(
      messages("our relay is at team.example, the code is WELCOME"),
      { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: { content: string; role: string }[];
    };
    const userContent = body.messages.find((m) => m.role === "user")?.content;
    expect(userContent).toContain("team.example");
  });

  it("re-validates model output through extractInvites (drops hallucinations)", async () => {
    // The model returns one canonical, extractable invite and one garbage
    // string that extractInvites rejects — only the valid one survives.
    const fetchImpl = vi.fn(async () =>
      completion(
        JSON.stringify({
          invites: [
            "buzz://join?relay=wss://real.example&code=GOOD",
            "totally not an invite at all",
          ],
        }),
      ),
    );
    const result = await llmExtractInvites(
      messages("come join: real.example, code GOOD"),
      { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual([
      { code: "GOOD", relayHost: "real.example", relayUrl: "wss://real.example" },
    ]);
  });

  it("dedupes re-validated invites by (relayHost, code)", async () => {
    const fetchImpl = vi.fn(async () =>
      completion(
        JSON.stringify({
          invites: [
            "buzz://join?relay=wss://dup.example&code=SAME",
            "https://dup.example/invite/SAME",
          ],
        }),
      ),
    );
    const result = await llmExtractInvites(
      messages("join dup.example with SAME"),
      { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual([
      { code: "SAME", relayHost: "dup.example", relayUrl: "wss://dup.example" },
    ]);
  });

  it("returns [] and never calls fetch when the API key is missing", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchImpl = vi.fn();
    const result = await llmExtractInvites(
      messages("join here: r.example code ABC"),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns [] on a transport error rather than throwing", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });
    const result = await llmExtractInvites(
      messages("join here: r.example code ABC"),
      { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual([]);
  });

  it("returns [] on a non-OK response", async () => {
    const fetchImpl = vi.fn(async () => json({ error: "x" }, 500));
    const result = await llmExtractInvites(
      messages("join here: r.example code ABC"),
      { apiKey: "k", fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result).toEqual([]);
  });

  it("caps the messages sent to the model at maxMessages", async () => {
    const fetchImpl = vi.fn(async () => completion('{"invites":[]}'));
    const many = Array.from({ length: 10 }, (_v, i) => ({
      content: `please join room ${i} somewhere`,
    }));
    await llmExtractInvites(many, {
      apiKey: "k",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxMessages: 3,
    });
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      messages: { content: string; role: string }[];
    };
    const userContent = body.messages.find((m) => m.role === "user")?.content;
    const sent = JSON.parse(userContent as string) as string[];
    expect(sent).toHaveLength(3);
  });
});
