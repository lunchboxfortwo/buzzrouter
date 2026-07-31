import { randomBytes } from "node:crypto";

import { describe, expect, it } from "vitest";

import { parseWrappingKeyFile } from "./connector";

describe("parseWrappingKeyFile", () => {
  it("loads versioned 32-byte wrapping keys", () => {
    const first = randomBytes(32);
    const second = randomBytes(32);
    const keys = parseWrappingKeyFile(
      JSON.stringify({
        1: first.toString("base64"),
        2: second.toString("base64"),
      }),
    );

    expect(keys.get(1)).toEqual(first);
    expect(keys.get(2)).toEqual(second);
  });

  it("rejects malformed and incorrectly sized keys", () => {
    expect(() => parseWrappingKeyFile("[]")).toThrowError(
      expect.objectContaining({ code: "wrapping_key_file_invalid" }),
    );
    expect(() =>
      parseWrappingKeyFile(
        JSON.stringify({ 1: randomBytes(16).toString("base64") }),
      ),
    ).toThrowError(
      expect.objectContaining({ code: "wrapping_key_file_invalid" }),
    );
  });
});
