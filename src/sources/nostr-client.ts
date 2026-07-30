import type { Event } from "nostr-tools/core";
import type { Filter } from "nostr-tools/filter";
import {
  SimplePool,
  useWebSocketImplementation,
} from "nostr-tools/pool";
import { WebSocket as NodeWebSocket } from "ws";

const MAX_EVENT_BYTES = 256 * 1_024;
const MAX_AGGREGATE_EVENT_BYTES = 8 * 1_024 * 1_024;
const MAX_WEBSOCKET_MESSAGE_BYTES = 512 * 1_024;

class SourceWebSocket extends NodeWebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols, {
      maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
  }
}

useWebSocketImplementation(SourceWebSocket);

export interface NostrQueryClient {
  query(relays: string[], filter: Filter): Promise<Event[]>;
}

interface NostrSubscription {
  close(reason?: string): void;
}

interface NostrRelay {
  subscribe(
    filters: Filter[],
    params: {
      eoseTimeout: number;
      onclose(reason: string): void;
      oneose(): void;
      onevent(event: Event): void;
    },
  ): NostrSubscription;
}

interface NostrPool {
  destroy(): void;
  ensureRelay(
    relayUrl: string,
    params: { connectionTimeout: number },
  ): Promise<NostrRelay>;
}

export function createNostrQueryClient(
  maxWaitMilliseconds = 8_000,
  createPool: () => NostrPool = () =>
    new SimplePool({
      enablePing: true,
      enableReconnect: false,
    }),
): NostrQueryClient {
  return {
    async query(relays, filter) {
      const maximumEvents = filter.limit;
      if (
        !Number.isInteger(maximumEvents) ||
        maximumEvents === undefined ||
        maximumEvents < 1 ||
        maximumEvents > 10_000
      ) {
        throw new Error(
          "Nostr source queries require a limit between 1 and 10000.",
        );
      }

      const pool = createPool();
      const events = new Map<string, Event>();
      let aggregateEventBytes = 0;

      try {
        await Promise.all(
          relays.map((relayUrl) =>
            queryRelay(
              pool,
              relayUrl,
              filter,
              maxWaitMilliseconds,
              (event) => {
                if (events.has(event.id)) {
                  return null;
                }
                if (events.size >= maximumEvents) {
                  return new Error(
                    "Nostr source relays exceeded the aggregate event limit.",
                  );
                }

                const eventBytes = Buffer.byteLength(
                  JSON.stringify(event),
                );
                if (eventBytes > MAX_EVENT_BYTES) {
                  return new Error(
                    "Nostr source relay returned an oversized event.",
                  );
                }
                if (
                  aggregateEventBytes + eventBytes >
                  MAX_AGGREGATE_EVENT_BYTES
                ) {
                  return new Error(
                    "Nostr source relays exceeded the aggregate byte limit.",
                  );
                }

                aggregateEventBytes += eventBytes;
                events.set(event.id, event);
                return null;
              },
            ),
          ),
        );

        return [...events.values()];
      } finally {
        pool.destroy();
      }
    },
  };
}

async function queryRelay(
  pool: NostrPool,
  relayUrl: string,
  filter: Filter,
  maxWaitMilliseconds: number,
  acceptEvent: (event: Event) => Error | null,
): Promise<void> {
  const relay = await pool.ensureRelay(relayUrl, {
    connectionTimeout: Math.min(maxWaitMilliseconds, 3_000),
  });

  return new Promise((resolve, reject) => {
    let settled = false;
    let subscription: NostrSubscription | undefined;
    const timeout = setTimeout(() => {
      finish(
        new Error("Nostr source relay did not send EOSE before timeout."),
      );
    }, maxWaitMilliseconds);

    const finish = (error?: Error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      subscription?.close("source query complete");
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    subscription = relay.subscribe([filter], {
      eoseTimeout: maxWaitMilliseconds + 1_000,
      onclose(reason) {
        finish(new Error(`Nostr source relay closed before EOSE: ${reason}`));
      },
      oneose() {
        finish();
      },
      onevent(event) {
        const error = acceptEvent(event);
        if (error) {
          finish(error);
        }
      },
    });
    if (settled) {
      subscription.close("source query complete");
    }
  });
}
