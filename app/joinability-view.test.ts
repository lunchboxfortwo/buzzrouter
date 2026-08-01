import { describe, expect, it } from "vitest";

import type { JoinStatus } from "../src/directory/joinability";
import { accessFlag, joinAffordance } from "./joinability-view";

function view(over: {
  inviteCode?: string | null;
  joinStatus?: JoinStatus | null;
  publicUrl?: string | null;
}) {
  return {
    inviteCode: over.inviteCode ?? null,
    joinStatus: over.joinStatus ?? null,
    publicUrl: over.publicUrl ?? null,
  };
}

describe("joinAffordance", () => {
  it("offers join for a public URL", () => {
    expect(joinAffordance(view({ publicUrl: "https://x.example" }))).toBe("join");
  });

  it("offers join for open, policy_gated, stale, unknown, and unprobed codes", () => {
    for (const joinStatus of [
      "open",
      "policy_gated",
      "stale",
      "unknown",
      null,
    ] as (JoinStatus | null)[]) {
      expect(joinAffordance(view({ inviteCode: "c", joinStatus }))).toBe("join");
    }
  });

  it("asks to request an invite only for a restricted community", () => {
    expect(
      joinAffordance(view({ inviteCode: "c", joinStatus: "restricted" })),
    ).toBe("request-invite");
  });

  it("offers nothing when there is neither a code nor a public URL", () => {
    expect(joinAffordance(view({}))).toBe("none");
  });
});

describe("accessFlag", () => {
  it("labels a probed-open code or public URL as open", () => {
    expect(accessFlag(view({ joinStatus: "open", inviteCode: "c" }))).toBe("open");
    expect(accessFlag(view({ publicUrl: "https://x.example" }))).toBe("open");
  });

  it("labels an unconfirmed code as invite-only rather than over-claiming open", () => {
    expect(accessFlag(view({ inviteCode: "c", joinStatus: "policy_gated" }))).toBe(
      "invite",
    );
    expect(accessFlag(view({ inviteCode: "c", joinStatus: null }))).toBe("invite");
  });

  it("is null when there is no join signal", () => {
    expect(accessFlag(view({}))).toBeNull();
  });
});
