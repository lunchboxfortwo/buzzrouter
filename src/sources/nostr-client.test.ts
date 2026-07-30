import type { Event } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import { describe, expect, it, vi } from "vitest";

import { createNostrQueryClient } from "./nostr-client";

const event = {
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  created_at: 1,
  kind: 1,
  tags: [],
  content: "",
  sig: "c".repeat(128),
} satisfies Event;
const secondEvent = {
  ...event,
  id: "d".repeat(64),
} satisfies Event;

describe("createNostrQueryClient", () => {
  it("requires every configured relay to complete with EOSE", async () => {
    const destroy = vi.fn();
    const client = createNostrQueryClient(20, () => ({
      destroy,
      ensureRelay: vi.fn(async (relayUrl: string) => ({
        subscribe: (
          _filters: Filter[],
          callbacks: {
            onclose(reason: string): void;
            oneose(): void;
            onevent(value: Event): void;
          },
        ) => {
          if (relayUrl.includes("complete")) {
            callbacks.onevent(event);
            callbacks.oneose();
          } else {
            callbacks.onclose("connection failed");
          }
          return { close: vi.fn() };
        },
      })),
    }));

    await expect(
      client.query(
        ["wss://complete.example", "wss://failed.example"],
        { kinds: [1], limit: 1 },
      ),
    ).rejects.toThrow("closed before EOSE");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("fails a relay that never completes instead of returning partial data", async () => {
    const client = createNostrQueryClient(5, () => ({
      destroy: vi.fn(),
      ensureRelay: vi.fn(async () => ({
        subscribe: (
          _filters: Filter[],
          callbacks: { onevent(value: Event): void },
        ) => {
          callbacks.onevent(event);
          return { close: vi.fn() };
        },
      })),
    }));

    await expect(
      client.query(
        ["wss://silent.example"],
        { kinds: [1], limit: 1 },
      ),
    ).rejects.toThrow("did not send EOSE");
  });

  it("enforces one aggregate event budget across all relays", async () => {
    const client = createNostrQueryClient(20, () => ({
      destroy: vi.fn(),
      ensureRelay: vi.fn(async (relayUrl: string) => ({
        subscribe: (
          _filters: Filter[],
          callbacks: {
            oneose(): void;
            onevent(value: Event): void;
          },
        ) => {
          callbacks.onevent(
            relayUrl.includes("first") ? event : secondEvent,
          );
          callbacks.oneose();
          return { close: vi.fn() };
        },
      })),
    }));

    await expect(
      client.query(
        ["wss://first.example", "wss://second.example"],
        { kinds: [1], limit: 1 },
      ),
    ).rejects.toThrow("aggregate event limit");
  });

  it("rejects an oversized event before retaining it", async () => {
    const oversizedEvent = {
      ...event,
      content: "x".repeat(300 * 1_024),
    };
    const client = createNostrQueryClient(20, () => ({
      destroy: vi.fn(),
      ensureRelay: vi.fn(async () => ({
        subscribe: (
          _filters: Filter[],
          callbacks: {
            oneose(): void;
            onevent(value: Event): void;
          },
        ) => {
          callbacks.onevent(oversizedEvent);
          callbacks.oneose();
          return { close: vi.fn() };
        },
      })),
    }));

    await expect(
      client.query(
        ["wss://source.example"],
        { kinds: [1], limit: 1 },
      ),
    ).rejects.toThrow("oversized event");
  });
});
