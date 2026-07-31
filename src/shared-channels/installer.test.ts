import { afterEach, describe, expect, it, vi } from "vitest";

import { createCommunityInstallToken } from "./installer";

describe("community connector installer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("does not create connector state when the CLI package is unavailable", async () => {
    vi.stubEnv("BUZZROUTER_CONNECT_PACKAGE_SPEC", "");
    const query = vi.fn();

    await expect(
      createCommunityInstallToken(
        { query } as never,
        {
          communityId: "00000000-0000-4000-8000-000000000000",
          ownerPubkey: "a".repeat(64),
        },
        { getKey: vi.fn() },
      ),
    ).rejects.toMatchObject({ code: "connector_package_unavailable" });
    expect(query).not.toHaveBeenCalled();
  });
});
