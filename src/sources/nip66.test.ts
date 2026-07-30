import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import {
  parseNip66Candidate,
  runNip66Source,
  sanitizeTimestampCursor,
} from "./nip66";

const monitorSecret = generateSecretKey();
const monitorPubkey = getPublicKey(monitorSecret);
const otherMonitor = "b".repeat(64);
const now = 1_785_387_600;

describe("parseNip66Candidate", () => {
  it("accepts a signed exact-software discovery event", () => {
    const event = finalizeEvent(
      {
        content: JSON.stringify({
          software: "https://github.com/block/buzz",
          supported_nips: [29, 42],
        }),
        created_at: now,
        kind: 30_166,
        tags: [
          ["d", "wss://relay.example.net/"],
          ["n", "clearnet"],
        ],
      },
      monitorSecret,
    );

    expect(
      parseNip66Candidate(
        event,
        [monitorPubkey, otherMonitor],
        now,
      ),
    ).toEqual({
      relayUrl: "wss://relay.example.net/",
      source: {
        type: "nip66",
        actorPubkey: monitorPubkey,
        evidenceId: event.id,
        observedAt: new Date(now * 1_000),
      },
    });
  });

  it("rejects another relay implementation", () => {
    const event = finalizeEvent(
      {
        content: JSON.stringify({
          software: "https://github.com/example/relay",
        }),
        created_at: now,
        kind: 30_166,
        tags: [["d", "wss://relay.example.net"]],
      },
      monitorSecret,
    );

    expect(
      parseNip66Candidate(
        event,
        [monitorPubkey, otherMonitor],
        now,
      ),
    ).toBeNull();
  });

  it("rejects non-clearnet and future events", () => {
    const event = finalizeEvent(
      {
        content: JSON.stringify({
          software: "https://github.com/block/buzz",
        }),
        created_at: now + 301,
        kind: 30_166,
        tags: [
          ["d", "wss://relay.example.net"],
          ["n", "tor"],
        ],
      },
      monitorSecret,
    );

    expect(
      parseNip66Candidate(
        event,
        [monitorPubkey, otherMonitor],
        now,
      ),
    ).toBeNull();
  });

  it("advances past a trusted event whose payload is rejected", async () => {
    const event = finalizeEvent(
      {
        content: JSON.stringify({
          software: "https://github.com/example/other",
        }),
        created_at: now,
        kind: 30_166,
        tags: [["d", "wss://relay.example.net"]],
      },
      monitorSecret,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ cursor: { since: now - 10 } }] })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;

    await expect(
      runNip66Source(
        pool,
        {} as PgBoss,
        { query: vi.fn().mockResolvedValue([event]) },
        {
          monitorPubkeys: [monitorPubkey, otherMonitor],
          sourceRelays: ["wss://source.example"],
        },
        now,
      ),
    ).resolves.toMatchObject({
      candidatesAccepted: 0,
      candidatesIgnored: 1,
      eventsRead: 1,
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("last_success_at"),
      [
        "nip66",
        JSON.stringify({ since: now }),
        expect.any(String),
      ],
    );
  });

  it("fails closed without checkpointing a saturated batch", async () => {
    const event = finalizeEvent(
      {
        content: JSON.stringify({
          software: "https://github.com/block/buzz",
        }),
        created_at: now,
        kind: 30_166,
        tags: [["d", "wss://relay.example.net"]],
      },
      monitorSecret,
    );
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ cursor: { since: now - 10 } }] })
      .mockResolvedValueOnce({ rows: [] });
    const pool = { query } as unknown as Pool;

    await expect(
      runNip66Source(
        pool,
        {} as PgBoss,
        { query: vi.fn().mockResolvedValue(Array(1_000).fill(event)) },
        {
          monitorPubkeys: [monitorPubkey, otherMonitor],
          sourceRelays: ["wss://source.example"],
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "incomplete_results" });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("last_error_code"),
      ["nip66", "incomplete_results"],
    );
  });
});

describe("sanitizeTimestampCursor", () => {
  it("keeps a current cursor and resets invalid timestamps", () => {
    expect(
      sanitizeTimestampCursor({ since: 900 }, 500, 1_000),
    ).toEqual({ since: 900 });
    expect(
      sanitizeTimestampCursor({ since: 1_301 }, 500, 1_000),
    ).toEqual({ since: 500 });
  });
});
