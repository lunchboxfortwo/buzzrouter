import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Event } from "nostr-tools/core";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { WebSocketServer, type WebSocket } from "ws";

const GROUP_METADATA_KIND = 39_000;

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const tlsCert = readFileSync(join(fixturesDir, "fake-relay-cert.pem"));
const tlsKey = readFileSync(join(fixturesDir, "fake-relay-key.pem"));

export interface FakeRelayGroup {
  id: string;
  name: string;
}

export interface FakeRelay {
  /** ws:// URL to store as a candidate's canonical_relay_url. */
  url: string;
  close(): Promise<void>;
}

interface RelayFilter {
  ids?: string[];
  kinds?: number[];
  authors?: string[];
  since?: number;
  until?: number;
  [tagFilter: string]: unknown;
}

/**
 * A minimal in-process Nostr relay for the e2e harness. It is deliberately NOT
 * a production dependency: it only implements the slice of the protocol the
 * BuzzRouter connector actually exercises during install/activation and the
 * relay-backed channel picker —
 *
 *   - accept EVENT, store it, ACK with `["OK", id, true]`
 *     (so connector activation's publish + hasEvent round trip succeeds against
 *     a real WebSocket rather than a stubbed relay factory);
 *   - answer REQ from stored events + EOSE
 *     (so hasEvent finds the just-published verification event, and the picker's
 *     listGroups() finds the seeded kind-39000 group metadata);
 *   - never send an AUTH challenge, so the connector's best-effort NIP-42
 *     `authenticate()` no-ops exactly as it does against a relay that doesn't
 *     require auth.
 *
 * It serves real TLS (`wss://`) with a committed self-signed cert for
 * 127.0.0.1, because candidate relay URLs must be `wss://` (a production check
 * constraint) and the production connection factory does a genuine TLS
 * handshake. The test server trusts the cert via NODE_EXTRA_CA_CERTS — no TLS
 * verification is disabled.
 *
 * Because the connection factory in src/shared-channels/connector.ts is used
 * unchanged, the connector's real code path runs for real here — only the relay
 * on the far end is a test double.
 */
export async function startFakeRelay(
  groups: FakeRelayGroup[],
): Promise<FakeRelay> {
  const stored = new Map<string, Event>();

  // Seed the relay's advertised channels as validly-signed kind-39000 group
  // metadata events; nostr-tools verifies signatures on receipt, so these must
  // be real events, not hand-built JSON.
  const relayKey = generateSecretKey();
  for (const group of groups) {
    const event = finalizeEvent(
      {
        content: "",
        created_at: 1_700_000_000,
        kind: GROUP_METADATA_KIND,
        tags: [
          ["d", group.id],
          ["name", group.name],
        ],
      },
      relayKey,
    );
    stored.set(event.id, event);
  }

  const server: Server = createServer({ cert: tlsCert, key: tlsKey });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket: WebSocket) => {
    socket.on("message", (raw) => {
      handleMessage(socket, raw.toString(), stored);
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `wss://127.0.0.1:${port}`,
    async close() {
      for (const client of wss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve, reject) => {
        wss.close((error) => (error ? reject(error) : resolve()));
      });
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function handleMessage(
  socket: WebSocket,
  raw: string,
  stored: Map<string, Event>,
): void {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(message)) {
    return;
  }

  const [type] = message;
  if (type === "EVENT") {
    const event = message[1] as Event;
    stored.set(event.id, event);
    socket.send(JSON.stringify(["OK", event.id, true, ""]));
    return;
  }
  if (type === "REQ") {
    const subscriptionId = message[1] as string;
    const filters = message.slice(2) as RelayFilter[];
    for (const event of stored.values()) {
      if (filters.some((filter) => matchFilter(filter, event))) {
        socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
      }
    }
    socket.send(JSON.stringify(["EOSE", subscriptionId]));
    return;
  }
  // CLOSE and anything else: nostr-tools manages its own subscription lifecycle,
  // so there is nothing to reply with.
}

function matchFilter(filter: RelayFilter, event: Event): boolean {
  if (filter.ids && !filter.ids.includes(event.id)) {
    return false;
  }
  if (filter.kinds && !filter.kinds.includes(event.kind)) {
    return false;
  }
  if (filter.authors && !filter.authors.includes(event.pubkey)) {
    return false;
  }
  if (typeof filter.since === "number" && event.created_at < filter.since) {
    return false;
  }
  if (typeof filter.until === "number" && event.created_at > filter.until) {
    return false;
  }
  for (const [key, values] of Object.entries(filter)) {
    if (!key.startsWith("#") || !Array.isArray(values)) {
      continue;
    }
    const tagName = key.slice(1);
    const eventValues = event.tags
      .filter((tag) => tag[0] === tagName)
      .map((tag) => tag[1]);
    if (!values.some((value) => eventValues.includes(value as string))) {
      return false;
    }
  }
  return true;
}
