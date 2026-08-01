import { describe, expect, it } from "vitest";

import { HOSTED_CREATE_NOTE } from "./copy";

/**
 * BuzzRouter retains a decryptable copy of every hosted-create owner key
 * (`store.ts` persists ciphertext + nonce + auth tag + wrapping key version,
 * and the host holds the wrapping key). Telling a user otherwise is a false
 * security claim, not a wording preference — the admin console depends on that
 * retained key existing.
 */
describe("hosted create custody disclosure", () => {
  it("never claims we keep no copy", () => {
    expect(HOSTED_CREATE_NOTE.toLowerCase()).not.toMatch(
      /(do not|don't|never|no longer)\s+(keep|retain|store|hold)[^.]*copy/,
    );
  });

  it("discloses that we retain a copy our server can decrypt", () => {
    const note = HOSTED_CREATE_NOTE.toLowerCase();
    expect(note).toContain("encrypted copy");
    expect(note).toContain("decrypt");
  });

  it("tells the user export is how they take sole control", () => {
    expect(HOSTED_CREATE_NOTE.toLowerCase()).toContain("export");
  });
});
