import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabasePool } from "../db/pool";
import {
  type GitHubCodeSearchClient,
  runGitHubSource,
} from "./github";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const relayUrl = "wss://github-invite-test.example";
const v2Code = "v2.umQGOlbNHvzs5fDVgxWCcU1N6ZmKr_3QAqPiuM4AgV4";

describeDatabase("GitHub source invite persistence", () => {
  let pool: Pool;
  const send = vi.fn().mockResolvedValue("probe-job");
  const boss = { send } as unknown as PgBoss;

  beforeAll(() => {
    process.env.DATABASE_URL = databaseUrl;
    pool = createDatabasePool();
  });

  beforeEach(async () => {
    send.mockClear();
    await pool.query(
      "DELETE FROM community_candidates WHERE canonical_relay_url = $1",
      [relayUrl],
    );
    await pool.query(
      "DELETE FROM discovery_source_state WHERE source_key = 'github'",
    );
  });

  afterAll(async () => {
    await pool?.query(
      "DELETE FROM community_candidates WHERE canonical_relay_url = $1",
      [relayUrl],
    );
    await pool?.query(
      "DELETE FROM discovery_source_state WHERE source_key = 'github'",
    );
    await pool?.end();
  });

  it("stores the matched invite and preserves it when the raw retry fails", async () => {
    const client = githubClient(
      `BUZZ_RELAY_URL=${relayUrl}\nBUZZ_INVITE=/invite/${v2Code}`,
    );
    await runGitHubSource(pool, boss, client);

    const stored = await pool.query<{ source_invite_code: string | null }>(
      `
        SELECT cs.source_invite_code
        FROM community_sources cs
        JOIN community_candidates cc ON cc.id = cs.candidate_id
        WHERE cc.canonical_relay_url = $1 AND cs.source_type = 'github'
      `,
      [relayUrl],
    );
    expect(stored.rows[0]?.source_invite_code).toBe(v2Code);
    const sendsAfterSuccess = send.mock.calls.length;
    expect(sendsAfterSuccess).toBeGreaterThan(0);

    client.fetchSourceText = vi.fn().mockRejectedValue(new Error("gone"));
    await runGitHubSource(pool, boss, client);

    const afterFailure = await pool.query<{
      source_invite_code: string | null;
    }>(
      `
        SELECT cs.source_invite_code
        FROM community_sources cs
        JOIN community_candidates cc ON cc.id = cs.candidate_id
        WHERE cc.canonical_relay_url = $1 AND cs.source_type = 'github'
      `,
      [relayUrl],
    );
    expect(afterFailure.rows[0]?.source_invite_code).toBe(v2Code);
    expect(send).toHaveBeenCalledTimes(sendsAfterSuccess);
  });
});

function githubClient(sourceText: string): GitHubCodeSearchClient {
  return {
    fetchSourceText: vi.fn().mockResolvedValue(sourceText),
    searchCode: vi.fn().mockResolvedValue({
      incomplete: false,
      items: [
        {
          evidenceId: "acme/community:relay.env",
          fragments: [`BUZZ_RELAY_URL=${relayUrl}`],
          htmlUrl:
            "https://github.com/acme/community/blob/main/relay.env",
        },
      ],
      totalCount: 1,
    }),
  };
}
