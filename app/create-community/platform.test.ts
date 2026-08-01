import { describe, expect, it } from "vitest";

import { detectPlatform } from "./platform";

const MAC_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
const WINDOWS_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const LINUX_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile";

describe("detectPlatform", () => {
  it("recognizes macOS", () => {
    expect(detectPlatform(MAC_UA)).toBe("macos");
  });

  it("recognizes Windows", () => {
    expect(detectPlatform(WINDOWS_UA)).toBe("windows");
  });

  it("recognizes Linux", () => {
    expect(detectPlatform(LINUX_UA)).toBe("linux");
  });

  it("does not misclassify Android (a Linux kernel) as desktop Linux", () => {
    expect(detectPlatform(ANDROID_UA)).toBe("unknown");
  });

  it("falls back to unknown for an unrecognized user agent", () => {
    expect(detectPlatform("curl/8.4.0")).toBe("unknown");
  });

  it("falls back to unknown for an empty user agent", () => {
    expect(detectPlatform("")).toBe("unknown");
  });

  it("falls back to unknown for a missing user agent", () => {
    expect(detectPlatform(null)).toBe("unknown");
    expect(detectPlatform(undefined)).toBe("unknown");
  });
});
