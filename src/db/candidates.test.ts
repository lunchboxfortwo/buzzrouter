import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";

import {
  claimDueCandidateIds,
  createEvidenceHash,
  normalizeCandidateSourceListing,
  normalizePublicRelayText,
} from "./candidates";

describe("claimDueCandidateIds", () => {
  it("returns the leased candidate IDs from the bounded query", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ id: "candidate-1" }, { id: "candidate-2" }],
    });
    const pool = { query } as unknown as Pool;

    await expect(claimDueCandidateIds(pool, 25)).resolves.toEqual([
      "candidate-1",
      "candidate-2",
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("FOR UPDATE SKIP LOCKED"),
      [25],
    );
  });

  it.each([0, -1, 1001, 1.5])("rejects unsafe batch limit %s", async (limit) => {
    const pool = { query: vi.fn() } as unknown as Pool;
    await expect(claimDueCandidateIds(pool, limit)).rejects.toThrow(
      "between 1 and 1000",
    );
  });
});

describe("normalizeCandidateSourceListing", () => {
  it("bounds and normalizes imported catalog metadata", () => {
    expect(
      normalizeCandidateSourceListing({
        audience: "  People building open protocols. ",
        categories: [" Builders ", "unknown", "BUILDERS", "Privacy"],
        contactEmail: "  Owner@Builders.example  ",
        description: "  People\n building together. ",
        displayName: "  Buzz Builders ",
        focus: "building",
        inviteCode: "  v2.abc123-invite ",
        publicUrl: "https://builders.example/join",
      }),
    ).toEqual({
      audience: "People building open protocols.",
      categories: ["builders", "privacy"],
      contactEmail: "owner@builders.example",
      description: "People building together.",
      displayName: "Buzz Builders",
      focus: "building",
      inviteCode: "v2.abc123-invite",
      publicUrl: "https://builders.example/join",
    });
  });

  it("rejects a non-https public url, blank invite code, invalid email, and unknown focus", () => {
    expect(
      normalizeCandidateSourceListing({
        contactEmail: "not-an-email",
        focus: "not-a-focus",
        inviteCode: "   ",
        publicUrl: "http://insecure.example",
      }),
    ).toMatchObject({
      contactEmail: null,
      focus: null,
      inviteCode: null,
      publicUrl: null,
    });
  });

  it("drops an invite code that is not a real Buzz code shape", () => {
    // Harvested "codes" have arrived as bare community names; a malformed
    // code must never be stored (see src/directory/invite-code-format.ts).
    for (const bogus of ["eco", "Wailyn", "virtualoranges"]) {
      expect(
        normalizeCandidateSourceListing({ inviteCode: bogus }).inviteCode,
      ).toBeNull();
    }
  });
});

describe("createEvidenceHash", () => {
  it("keeps independent Nostr monitors as distinct evidence", () => {
    const first = createEvidenceHash("wss://relay.example.com", {
      type: "nip66",
      actorPubkey: "a".repeat(64),
      evidenceId: "1".repeat(64),
    });
    const second = createEvidenceHash("wss://relay.example.com", {
      type: "nip66",
      actorPubkey: "b".repeat(64),
      evidenceId: "2".repeat(64),
    });

    expect(first).not.toBe(second);
  });

  it("deduplicates the same signed event", () => {
    const source = {
      type: "nip65" as const,
      actorPubkey: "a".repeat(64),
      evidenceId: "1".repeat(64),
    };

    expect(
      createEvidenceHash("wss://relay.example.com", source),
    ).toBe(createEvidenceHash("wss://relay.example.com", source));
  });

  it("keeps one current evidence row per Nostr actor", () => {
    const base = {
      type: "nip66" as const,
      actorPubkey: "a".repeat(64),
    };

    expect(
      createEvidenceHash("wss://relay.example.com", {
        ...base,
        evidenceId: "1".repeat(64),
      }),
    ).toBe(
      createEvidenceHash("wss://relay.example.com", {
        ...base,
        evidenceId: "2".repeat(64),
      }),
    );
  });
});

describe("normalizePublicRelayText", () => {
  it("collapses whitespace and enforces the public metadata bound", () => {
    expect(normalizePublicRelayText("  A\n useful   relay  ", 10)).toBe(
      "A useful r",
    );
  });

  it("returns null for missing public metadata", () => {
    expect(normalizePublicRelayText(" \n ", 20)).toBeNull();
    expect(normalizePublicRelayText(undefined, 20)).toBeNull();
  });
});
