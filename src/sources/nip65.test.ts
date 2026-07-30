import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  parseNip65Candidates,
  runNip65Source,
} from "./nip65";

const authorSecret = generateSecretKey();
const authorPubkey = getPublicKey(authorSecret);

describe("parseNip65Candidates", () => {
  it("extracts signed relay hints with author provenance", () => {
    const event = finalizeEvent(
      {
        content: "",
        created_at: 1_785_387_600,
        kind: 10_002,
        tags: [
          ["r", "wss://first.example.net", "read"],
          ["r", "wss://second.example.net", "write"],
          ["ignored", "wss://ignored.example.net"],
        ],
      },
      authorSecret,
    );

    expect(parseNip65Candidates(event, [authorPubkey])).toEqual([
      {
        relayUrl: "wss://first.example.net",
        source: {
          type: "nip65",
          actorPubkey: authorPubkey,
          evidenceId: event.id,
          observedAt: new Date(1_785_387_600 * 1_000),
        },
      },
      {
        relayUrl: "wss://second.example.net",
        source: {
          type: "nip65",
          actorPubkey: authorPubkey,
          evidenceId: event.id,
          observedAt: new Date(1_785_387_600 * 1_000),
        },
      },
    ]);
  });

  it("rejects events outside the author allowlist", () => {
    const event = finalizeEvent(
      {
        content: "",
        created_at: 1_785_387_600,
        kind: 10_002,
        tags: [["r", "wss://relay.example.net"]],
      },
      authorSecret,
    );

    expect(parseNip65Candidates(event, ["c".repeat(64)])).toEqual([]);
  });

  it("advances past a trusted event without relay tags", async () => {
    const createdAt = 1_785_387_600;
    const event = finalizeEvent(
      {
        content: "",
        created_at: createdAt,
        kind: 10_002,
        tags: [],
      },
      authorSecret,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ cursor: { since: createdAt - 10 } }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;

    await expect(
      runNip65Source(
        pool,
        {} as PgBoss,
        { query: vi.fn().mockResolvedValue([event]) },
        {
          authors: [authorPubkey],
          sourceRelays: ["wss://source.example"],
        },
        createdAt,
      ),
    ).resolves.toMatchObject({
      candidatesAccepted: 0,
      eventsRead: 1,
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("last_success_at"),
      [
        "nip65",
        JSON.stringify({ since: createdAt }),
        expect.any(String),
      ],
    );
  });

  it("fails closed without checkpointing a saturated batch", async () => {
    const event = finalizeEvent(
      {
        content: "",
        created_at: 1_785_387_600,
        kind: 10_002,
        tags: [["r", "wss://relay.example.net"]],
      },
      authorSecret,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [{ cursor: { since: event.created_at - 10 } }],
      })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;

    await expect(
      runNip65Source(
        pool,
        {} as PgBoss,
        { query: vi.fn().mockResolvedValue(Array(500).fill(event)) },
        {
          authors: [authorPubkey],
          sourceRelays: ["wss://source.example"],
        },
        event.created_at,
      ),
    ).rejects.toMatchObject({ code: "incomplete_results" });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("last_error_code"),
      ["nip65", "incomplete_results"],
    );
  });
});
