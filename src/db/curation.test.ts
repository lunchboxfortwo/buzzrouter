import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { setCandidateSuppressed, setListingCuration } from "./curation";

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";

describe("setListingCuration", () => {
  it("upserts a curated focus and display name override", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await setListingCuration(pool, {
      candidateId: CANDIDATE_ID,
      curatedBy: "internal-console",
      displayNameOverride: "  Buzz Builders  ",
      focus: "building",
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("ON CONFLICT (candidate_id) DO UPDATE"),
      [CANDIDATE_ID, "building", "Buzz Builders", "internal-console", true, true],
    );
  });

  it("rejects an invalid candidate id", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(
      setListingCuration(pool, {
        candidateId: "not-a-uuid",
        curatedBy: "internal-console",
        focus: "building",
      }),
    ).rejects.toThrow("Candidate id is invalid.");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a focus slug that is not in the vocabulary", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(
      setListingCuration(pool, {
        candidateId: CANDIDATE_ID,
        curatedBy: "internal-console",
        focus: "not-a-real-focus",
      }),
    ).rejects.toThrow("Focus is invalid.");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects a display name override over 120 characters", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(
      setListingCuration(pool, {
        candidateId: CANDIDATE_ID,
        curatedBy: "internal-console",
        displayNameOverride: "x".repeat(121),
      }),
    ).rejects.toThrow("120 characters or fewer");
    expect(query).not.toHaveBeenCalled();
  });

  it("requires curatedBy", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(
      setListingCuration(pool, {
        candidateId: CANDIDATE_ID,
        curatedBy: "   ",
        focus: "building",
      }),
    ).rejects.toThrow("curatedBy is required.");
    expect(query).not.toHaveBeenCalled();
  });

  it("leaves an omitted field untouched instead of nulling it out", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await setListingCuration(pool, {
      candidateId: CANDIDATE_ID,
      curatedBy: "internal-console",
      focus: "ai-agents",
      // displayNameOverride intentionally omitted
    });

    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      [CANDIDATE_ID, "ai-agents", null, "internal-console", true, false],
    );
  });

  it("clears a field when it is explicitly passed as null", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await setListingCuration(pool, {
      candidateId: CANDIDATE_ID,
      curatedBy: "internal-console",
      displayNameOverride: null,
    });

    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      [CANDIDATE_ID, null, null, "internal-console", false, true],
    );
  });

  it("coerces an empty display name override to null", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await setListingCuration(pool, {
      candidateId: CANDIDATE_ID,
      curatedBy: "internal-console",
      displayNameOverride: "   ",
    });

    expect(query).toHaveBeenCalledWith(
      expect.any(String),
      [CANDIDATE_ID, null, null, "internal-console", false, true],
    );
  });
});

describe("setCandidateSuppressed", () => {
  it("suppresses a candidate", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await setCandidateSuppressed(pool, CANDIDATE_ID, true, "internal-console");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET state = $2"),
      [CANDIDATE_ID, "suppressed", "internal-console"],
    );
  });

  it("restores a candidate for re-probing instead of asserting verification", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await setCandidateSuppressed(pool, CANDIDATE_ID, false, "internal-console");

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("next_probe_at"),
      [CANDIDATE_ID, "discovered", "internal-console"],
    );
  });

  it("rejects an invalid candidate id", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(
      setCandidateSuppressed(pool, "not-a-uuid", true, "internal-console"),
    ).rejects.toThrow("Candidate id is invalid.");
    expect(query).not.toHaveBeenCalled();
  });

  it("requires curatedBy", async () => {
    const query = vi.fn();
    const pool = { query } as unknown as Pool;

    await expect(
      setCandidateSuppressed(pool, CANDIDATE_ID, true, ""),
    ).rejects.toThrow("curatedBy is required.");
    expect(query).not.toHaveBeenCalled();
  });
});
