import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  claimPendingValidations,
  createSubmissionValidation,
  getSubmissionValidation,
  resolveSubmissionValidation,
} from "./submission-validations";

describe("createSubmissionValidation", () => {
  it("inserts a pending row and returns the RETURNING id", async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ id: "val-1" }] });
    const pool = { query } as unknown as Pool;

    await expect(
      createSubmissionValidation(pool, {
        inviteCode: "INV-CODE",
        relayHost: "builders.example",
        relayUrl: "wss://builders.example",
      }),
    ).resolves.toBe("val-1");

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("INSERT INTO submission_validations");
    expect(sql).toContain("RETURNING id");
    expect(params).toEqual([
      "builders.example",
      "wss://builders.example",
      "INV-CODE",
    ]);
  });
});

describe("getSubmissionValidation", () => {
  it("returns the mapped row when one matches the id", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ candidate_id: "cand-1", message: "ok", status: "valid" }],
    });
    const pool = { query } as unknown as Pool;

    await expect(getSubmissionValidation(pool, "val-1")).resolves.toEqual({
      candidateId: "cand-1",
      message: "ok",
      status: "valid",
    });
    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("SELECT status, candidate_id, message");
    expect(sql).toContain("WHERE id = $1");
    expect(params).toEqual(["val-1"]);
  });

  it("returns null when no row matches the id", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;
    await expect(getSubmissionValidation(pool, "missing")).resolves.toBeNull();
  });
});

describe("claimPendingValidations", () => {
  it("claims pending rows with FOR UPDATE SKIP LOCKED and maps them", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "val-1",
          invite_code: "INV-1",
          relay_host: "a.example",
          relay_url: "wss://a.example",
        },
        {
          id: "val-2",
          invite_code: "INV-2",
          relay_host: "b.example",
          relay_url: "wss://b.example",
        },
      ],
    });
    const pool = { query } as unknown as Pool;

    await expect(claimPendingValidations(pool, 5)).resolves.toEqual([
      {
        id: "val-1",
        inviteCode: "INV-1",
        relayHost: "a.example",
        relayUrl: "wss://a.example",
      },
      {
        id: "val-2",
        inviteCode: "INV-2",
        relayHost: "b.example",
        relayUrl: "wss://b.example",
      },
    ]);

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE submission_validations SET status = 'processing'");
    expect(sql).toContain("WHERE status = 'pending'");
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("LIMIT $1");
    expect(sql).toContain("RETURNING id, relay_host, relay_url, invite_code");
    expect(params).toEqual([5]);
  });
});

describe("resolveSubmissionValidation", () => {
  it("updates status, candidate, and message with resolved_at", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await resolveSubmissionValidation(pool, "val-1", {
      candidateId: "cand-1",
      message: "matched",
      status: "valid",
    });

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("UPDATE submission_validations");
    expect(sql).toContain("resolved_at = now()");
    expect(sql).toContain("WHERE id = $1");
    expect(params).toEqual(["val-1", "valid", "cand-1", "matched"]);
  });

  it("defaults candidateId and message to null when omitted", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const pool = { query } as unknown as Pool;

    await resolveSubmissionValidation(pool, "val-2", { status: "error" });

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual(["val-2", "error", null, null]);
  });
});
