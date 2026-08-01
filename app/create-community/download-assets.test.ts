import { describe, expect, it, vi } from "vitest";

import {
  BUZZ_RELEASES_URL,
  findMatchingAsset,
  resolveDownloadUrl,
} from "./download-assets";

const RELEASES = [
  {
    assets: [
      {
        browser_download_url: "https://example.test/buzz_1.2.0_aarch64.dmg",
        name: "buzz_1.2.0_aarch64.dmg",
      },
      {
        browser_download_url: "https://example.test/buzz_1.2.0_amd64.AppImage",
        name: "buzz_1.2.0_amd64.AppImage",
      },
    ],
    draft: false,
    prerelease: false,
  },
];

describe("findMatchingAsset", () => {
  it("matches a macOS arm64 asset", () => {
    expect(findMatchingAsset(RELEASES, "macos", "arm64")).toBe(
      "https://example.test/buzz_1.2.0_aarch64.dmg",
    );
  });

  it("matches a linux x64 asset", () => {
    expect(findMatchingAsset(RELEASES, "linux", "x64")).toBe(
      "https://example.test/buzz_1.2.0_amd64.AppImage",
    );
  });

  it("returns undefined when no asset matches", () => {
    expect(findMatchingAsset(RELEASES, "windows", "x64")).toBeUndefined();
  });

  it("skips draft and prerelease releases", () => {
    const draftOnly = [{ ...RELEASES[0], draft: true }];
    expect(findMatchingAsset(draftOnly, "macos", "arm64")).toBeUndefined();
  });
});

describe("resolveDownloadUrl", () => {
  it("returns the matched asset when the API call succeeds", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(RELEASES),
      ok: true,
    });
    const url = await resolveDownloadUrl("linux", "x64", fetchImpl as unknown as typeof fetch);
    expect(url).toBe("https://example.test/buzz_1.2.0_amd64.AppImage");
  });

  it("falls back to the releases page when the API call fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));
    const url = await resolveDownloadUrl("linux", "x64", fetchImpl as unknown as typeof fetch);
    expect(url).toBe(BUZZ_RELEASES_URL);
  });

  it("falls back to the releases page when the response is not ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });
    const url = await resolveDownloadUrl("linux", "x64", fetchImpl as unknown as typeof fetch);
    expect(url).toBe(BUZZ_RELEASES_URL);
  });

  it("falls back to the releases page when no asset matches", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      json: () => Promise.resolve(RELEASES),
      ok: true,
    });
    const url = await resolveDownloadUrl("windows", "x64", fetchImpl as unknown as typeof fetch);
    expect(url).toBe(BUZZ_RELEASES_URL);
  });
});
