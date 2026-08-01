import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createDatabasePool } from "../../../src/db/pool";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase(
  "POST /api/submissions carries the candidate id forward",
  () => {
    let pool: Pool;

    beforeAll(async () => {
      process.env.DATABASE_URL = databaseUrl;
      pool = createDatabasePool();
    });

    beforeEach(async () => {
      await pool.query(
        "DELETE FROM community_candidates WHERE canonical_relay_url = $1",
        ["wss://submit-test.example"],
      );
    });

    afterAll(async () => {
      await pool?.end();
    });

    it("redirects with a candidate id a submitter can bookmark", async () => {
      const { POST } = await import("./route");

      const response = await POST(
        new Request("https://buzzrouter.com/api/submissions", {
          body: new URLSearchParams({
            audience: "Builders shipping on Nostr",
            categories: "builders",
            communityName: "Submit Test Community",
            contactEmail: "owner@submit-test.example",
            description: "A relay for testing submissions.",
            focus: "building",
            relayUrl: "wss://submit-test.example",
          }).toString(),
          headers: {
            "content-type": "application/x-www-form-urlencoded",
            origin: "https://buzzrouter.com",
          },
          method: "POST",
        }),
      );

      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.searchParams.get("status")).toBe("queued");
      expect(location.searchParams.get("host")).toBe("submit-test.example");
      const candidateId = location.searchParams.get("candidate");
      expect(candidateId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );

      const stored = await pool.query(
        "SELECT id FROM community_candidates WHERE canonical_relay_url = $1",
        ["wss://submit-test.example"],
      );
      expect(stored.rows[0]?.id).toBe(candidateId);

      const source = await pool.query(
        `
          SELECT
            source_audience,
            source_categories,
            source_contact_email,
            source_description,
            source_display_name,
            source_focus
          FROM community_sources
          WHERE candidate_id = $1 AND source_type = 'submission'
        `,
        [candidateId],
      );
      expect(source.rows[0]).toMatchObject({
        source_audience: "Builders shipping on Nostr",
        source_categories: ["builders"],
        source_contact_email: "owner@submit-test.example",
        source_description: "A relay for testing submissions.",
        source_display_name: "Submit Test Community",
        source_focus: "building",
      });
    });
  },
);
