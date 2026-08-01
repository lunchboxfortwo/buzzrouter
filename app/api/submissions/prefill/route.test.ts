import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../src/db/pool", () => ({
  getDatabasePool: () => "pool",
}));

const getSubmissionPrefill = vi.fn();
vi.mock("../../../../src/db/directory", () => ({
  getSubmissionPrefill: (...args: unknown[]) =>
    getSubmissionPrefill(...args),
}));

describe("GET /api/submissions/prefill", () => {
  afterEach(() => {
    getSubmissionPrefill.mockReset();
  });

  it("normalizes the relay URL and returns known catalog metadata", async () => {
    getSubmissionPrefill.mockResolvedValue({
      categories: ["builders"],
      description: "People building together.",
      displayName: "Buzz Builders",
      focus: "building",
    });
    const { GET } = await import("./route");

    const response = await GET(
      new Request(
        "https://buzzrouter.com/api/submissions/prefill?relayUrl=wss%3A%2F%2Fbuilders.example%2F",
      ),
    );
    const body = await response.json();

    expect(getSubmissionPrefill).toHaveBeenCalledWith(
      "pool",
      "wss://builders.example",
    );
    expect(body).toEqual({
      prefill: {
        categories: ["builders"],
        description: "People building together.",
        displayName: "Buzz Builders",
        focus: "building",
      },
    });
  });

  it("returns a null prefill for an unknown relay", async () => {
    getSubmissionPrefill.mockResolvedValue(null);
    const { GET } = await import("./route");

    const response = await GET(
      new Request(
        "https://buzzrouter.com/api/submissions/prefill?relayUrl=wss%3A%2F%2Funknown.example",
      ),
    );

    expect(await response.json()).toEqual({ prefill: null });
  });

  it("returns a null prefill without querying the database for an invalid relay URL", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request(
        "https://buzzrouter.com/api/submissions/prefill?relayUrl=not-a-url",
      ),
    );

    expect(await response.json()).toEqual({ prefill: null });
    expect(getSubmissionPrefill).not.toHaveBeenCalled();
  });

  it("treats a missing relayUrl param as invalid", async () => {
    const { GET } = await import("./route");

    const response = await GET(
      new Request("https://buzzrouter.com/api/submissions/prefill"),
    );

    expect(await response.json()).toEqual({ prefill: null });
    expect(getSubmissionPrefill).not.toHaveBeenCalled();
  });
});
