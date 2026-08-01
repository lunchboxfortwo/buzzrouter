import { createHash } from "node:crypto";

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
        "DELETE FROM community_candidates WHERE canonical_relay_url = ANY($1)",
        [["wss://submit-test.example", "wss://submit-logo-test.example"]],
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

      const icon = await pool.query(
        "SELECT 1 FROM community_icons WHERE candidate_id = $1",
        [candidateId],
      );
      expect(icon.rows).toHaveLength(0);
    });

    it("stores an uploaded logo alongside the candidate", async () => {
      const { POST } = await import("./route");

      const pngBytes = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(32, 7),
      ]);
      const form = new FormData();
      form.set("relayUrl", "wss://submit-logo-test.example");
      form.set("contactEmail", "owner@submit-logo-test.example");
      form.set(
        "logo",
        new File([Uint8Array.from(pngBytes)], "logo.png", {
          type: "image/png",
        }),
      );

      const response = await POST(
        new Request("https://buzzrouter.com/api/submissions", {
          body: form,
          headers: { origin: "https://buzzrouter.com" },
          method: "POST",
        }),
      );

      expect(response.status).toBe(303);
      const location = new URL(response.headers.get("location") ?? "");
      expect(location.searchParams.get("status")).toBe("queued");
      const candidateId = location.searchParams.get("candidate");

      const icon = await pool.query<{
        content_type: string;
        content_hash: string;
        image_bytes: Buffer;
      }>(
        `
          SELECT content_type, content_hash, image_bytes
          FROM community_icons
          WHERE candidate_id = $1
        `,
        [candidateId],
      );
      expect(icon.rows).toHaveLength(1);
      expect(icon.rows[0]?.content_type).toBe("image/png");
      expect(icon.rows[0]?.image_bytes.equals(pngBytes)).toBe(true);
      expect(icon.rows[0]?.content_hash).toBe(
        createHash("sha256").update(pngBytes).digest("hex"),
      );
    });
  },
);
