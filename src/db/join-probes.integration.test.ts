import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabasePool } from "./pool";
import { listDirectoryCommunities } from "./directory";
import {
  listCandidatesForJoinProbe,
  recordJoinProbe,
} from "./join-probes";

/**
 * The directory must only claim "joinable" while a probe verdict is FRESH and
 * still pinned to the advertised code — and the probe job must re-surface a
 * verdict once it decays. These exercise that against a real Postgres, since it
 * lives in the SQL freshness/rotation predicates, not in TypeScript.
 */

const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

const RELAY_URL = "wss://join-probe-test.example";
const HOST = "join-probe-test.example";

describeDatabase("community join-probe verdicts", () => {
  const pool: Pool = (() => {
    process.env.DATABASE_URL = databaseUrl;
    return createDatabasePool();
  })();

  async function seedVerifiedCandidateWithCode(code: string): Promise<string> {
    const candidate = await pool.query<{ id: string }>(
      `
        INSERT INTO community_candidates (canonical_relay_url, host, state)
        VALUES ($1, $2, 'verified_buzz')
        RETURNING id
      `,
      [RELAY_URL, HOST],
    );
    const candidateId = candidate.rows[0].id;
    // A directory row only surfaces off a successful, recent, TLS-valid probe.
    await pool.query(
      `
        INSERT INTO probe_snapshots
          (candidate_id, probed_at, tls_valid, result_code, supported_nips)
        VALUES ($1, now(), true, 'exact_software_and_protocol', '[]'::jsonb)
      `,
      [candidateId],
    );
    await pool.query(
      `
        INSERT INTO community_sources
          (candidate_id, source_type, evidence_hash, source_observed_at,
           source_invite_code)
        VALUES ($1, 'harvest', $2, now(), $3)
      `,
      [candidateId, randomUUID(), code],
    );
    return candidateId;
  }

  async function joinStatusOf(): Promise<string | null> {
    const rows = await listDirectoryCommunities(pool, { limit: 200 });
    const row = rows.find((c) => c.relayHost === HOST);
    return row ? row.joinStatus : "ROW_MISSING";
  }

  beforeEach(async () => {
    await pool.query(
      "DELETE FROM community_candidates WHERE canonical_relay_url = $1",
      [RELAY_URL],
    );
  });

  afterAll(async () => {
    await pool.query(
      "DELETE FROM community_candidates WHERE canonical_relay_url = $1",
      [RELAY_URL],
    );
    await pool.end();
  });

  it("surfaces a fresh open verdict as joinStatus=open", async () => {
    const candidateId = await seedVerifiedCandidateWithCode("code-1");
    await recordJoinProbe(pool, {
      candidateId,
      code: "code-1",
      status: "open",
    });

    expect(await joinStatusOf()).toBe("open");
  });

  it("DECAYS a stale open verdict to null so it stops reading as joinable", async () => {
    const candidateId = await seedVerifiedCandidateWithCode("code-1");
    await recordJoinProbe(pool, {
      candidateId,
      code: "code-1",
      status: "open",
    });
    // Age the verdict past the directory's 12h trust window.
    await pool.query(
      "UPDATE community_join_probes SET probed_at = now() - interval '2 days' WHERE candidate_id = $1",
      [candidateId],
    );

    expect(await joinStatusOf()).toBeNull();
  });

  it("invalidates a verdict recorded against a since-rotated code", async () => {
    const candidateId = await seedVerifiedCandidateWithCode("code-1");
    await recordJoinProbe(pool, {
      candidateId,
      code: "code-1",
      status: "open",
    });
    // A fresh invite is swapped in; the old verdict must not carry over.
    await pool.query(
      "UPDATE community_sources SET source_invite_code = 'code-2', source_observed_at = now() WHERE candidate_id = $1",
      [candidateId],
    );

    expect(await joinStatusOf()).toBeNull();
  });

  it("re-surfaces never-probed, decayed, and code-rotated candidates for probing", async () => {
    const candidateId = await seedVerifiedCandidateWithCode("code-1");

    // Never probed → due.
    const future = new Date(Date.now() + 60_000);
    let due = await listCandidatesForJoinProbe(pool, {
      limit: 10,
      staleBefore: future,
    });
    expect(due.map((d) => d.candidateId)).toContain(candidateId);
    expect(due.find((d) => d.candidateId === candidateId)?.code).toBe("code-1");

    // Freshly probed → NOT due against a past window.
    await recordJoinProbe(pool, {
      candidateId,
      code: "code-1",
      status: "open",
    });
    const past = new Date(Date.now() - 60_000);
    due = await listCandidatesForJoinProbe(pool, { limit: 10, staleBefore: past });
    expect(due.map((d) => d.candidateId)).not.toContain(candidateId);

    // Decayed (probed before the window) → due again.
    due = await listCandidatesForJoinProbe(pool, {
      limit: 10,
      staleBefore: future,
    });
    expect(due.map((d) => d.candidateId)).toContain(candidateId);

    // Code rotated → due even though the verdict is fresh.
    await pool.query(
      "UPDATE community_sources SET source_invite_code = 'code-2', source_observed_at = now() WHERE candidate_id = $1",
      [candidateId],
    );
    due = await listCandidatesForJoinProbe(pool, { limit: 10, staleBefore: past });
    const target = due.find((d) => d.candidateId === candidateId);
    expect(target?.code).toBe("code-2");
  });
});
