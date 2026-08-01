import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Event } from "nostr-tools/core";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { WebSocketServer, type WebSocket } from "ws";

const GROUP_METADATA_KIND = 39_000;
const ROSTER_KIND = 13_534;

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const tlsCert = readFileSync(join(fixturesDir, "fake-relay-cert.pem"));
const tlsKey = readFileSync(join(fixturesDir, "fake-relay-key.pem"));

export interface FakeRelayGroup {
  id: string;
  name: string;
}

export interface FakeRosterMember {
  pubkey: string;
  role: string;
}

export interface FakeRelay {
  /** wss:// URL to store as a candidate's canonical_relay_url. */
  url: string;
  close(): Promise<void>;
  /**
   * Push an already-signed event to every open subscription whose filters match
   * (and remember it for later REQs). This is how a test simulates a member
   * typing a message into a channel the connector is listening to.
   */
  injectEvent(event: Event): void;
  /**
   * Publish (or replace) the community's kind-13534 roster with inline member
   * roles, so the connector's readRoster() can resolve who is owner/admin.
   */
  setRoster(members: FakeRosterMember[]): void;
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
 * BuzzRouter connector actually exercises during install/activation, the
 * relay-backed channel picker, and the chat-proof confirmation flow —
 *
 *   - accept EVENT, store it, ACK with `["OK", id, true]`
 *     (so connector activation's publish + hasEvent round trip succeeds against
 *     a real WebSocket rather than a stubbed relay factory);
 *   - answer REQ from stored events + EOSE, then KEEP the subscription open so
 *     later injected events reach it live
 *     (so hasEvent finds the just-published verification event, the picker's
 *     listGroups() finds the seeded kind-39000 group metadata, readRoster()
 *     finds the kind-13534 roster, and a confirmation kind-9 injected after the
 *     connector subscribes is actually delivered);
 *   - never send an AUTH challenge, so the connector's `authenticate()` waits
 *     out its full settle deadline and then no-ops exactly as it does against
 *     a relay that genuinely doesn't require auth (tests that hit this path
 *     allow extra time for that bounded wait).
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
  // subscriptionId -> filters, per connected socket, so injected events can be
  // pushed live to whatever the connector is currently listening for.
  const subscriptions = new Map<WebSocket, Map<string, RelayFilter[]>>();
  // The relay signs its own metadata/roster; nostr-tools verifies signatures on
  // receipt, so these must be real events, not hand-built JSON.
  const relayKey = generateSecretKey();
  let rosterEventId: string | undefined;

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
    subscriptions.set(socket, new Map());
    socket.on("message", (raw) => {
      handleMessage(socket, raw.toString(), stored, subscriptions);
    });
    socket.on("close", () => {
      subscriptions.delete(socket);
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
    injectEvent(event: Event) {
      stored.set(event.id, event);
      pushToSubscribers(event, subscriptions);
    },
    setRoster(members: FakeRosterMember[]) {
      if (rosterEventId) stored.delete(rosterEventId);
      const event = finalizeEvent(
        {
          content: "",
          created_at: 1_700_000_100,
          kind: ROSTER_KIND,
          tags: members.map((member) => ["p", member.pubkey, member.role]),
        },
        relayKey,
      );
      stored.set(event.id, event);
      rosterEventId = event.id;
    },
  };
}

function handleMessage(
  socket: WebSocket,
  raw: string,
  stored: Map<string, Event>,
  subscriptions: Map<WebSocket, Map<string, RelayFilter[]>>,
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
    pushToSubscribers(event, subscriptions);
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
    // Keep the subscription open so events injected later are delivered live.
    subscriptions.get(socket)?.set(subscriptionId, filters);
    return;
  }
  if (type === "CLOSE") {
    const subscriptionId = message[1] as string;
    subscriptions.get(socket)?.delete(subscriptionId);
    return;
  }
}

function pushToSubscribers(
  event: Event,
  subscriptions: Map<WebSocket, Map<string, RelayFilter[]>>,
): void {
  for (const [socket, subs] of subscriptions) {
    for (const [subscriptionId, filters] of subs) {
      if (filters.some((filter) => matchFilter(filter, event))) {
        socket.send(JSON.stringify(["EVENT", subscriptionId, event]));
      }
    }
  }
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
