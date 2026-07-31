import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildInstallerCommand,
  createCommunityInstallToken,
} from "./installer";

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

  it("pins GitHub release artifacts in generated commands", () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    vi.stubEnv(
      "BUZZROUTER_CONNECT_PACKAGE_SPEC",
      "https://github.com/lunchboxfortwo/buzzrouter/releases/download/connect-v0.1.0/buzzrouter-connect-0.1.0.tgz",
    );

    expect(buildInstallerCommand("a".repeat(43))).toBe(
      "npx --yes --package=https://github.com/lunchboxfortwo/buzzrouter/releases/download/connect-v0.1.0/buzzrouter-connect-0.1.0.tgz buzzrouter-connect " +
        `${"a".repeat(43)} --router https://buzzrouter.com`,
    );
  });

  it("rejects mutable or mismatched release artifacts", () => {
    vi.stubEnv("PUBLIC_APP_ORIGIN", "https://buzzrouter.com");
    vi.stubEnv(
      "BUZZROUTER_CONNECT_PACKAGE_SPEC",
      "https://github.com/lunchboxfortwo/buzzrouter/releases/latest/download/buzzrouter-connect-0.1.0.tgz",
    );

    expect(() => buildInstallerCommand("a".repeat(43))).toThrow(
      "installer is not published",
    );
  });
});
