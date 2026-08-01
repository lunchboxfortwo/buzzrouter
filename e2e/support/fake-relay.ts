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
const GROUP_CREATE_KIND = 9_007;
const GROUP_PUT_USER_KIND = 9_000;

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
  /**
   * The groups the relay currently knows — seeded plus any created live by a
   * kind-9007. Lets a test assert the bridge really created a channel (and its
   * name).
   */
  channels(): FakeRelayGroup[];
  /**
   * The community roster as it stands after any kind-9000 put-user events, so a
   * test can assert ownership was transferred and the bot stepped down.
   */
  roster(): FakeRosterMember[];
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
 *   - model NIP-29 group management: a kind-9007 makes a channel listable and a
 *     kind-9000 writes a role into the roster, so the bridge creating a
 *     dedicated channel and handing off ownership has visible effects, not just
 *     an ACK (see applyGroupManagement);
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
  // Live group + roster state so 9007/9000 are MODELLED (a created channel
  // becomes listable; a granted role shows up in the roster), not just ACKed.
  const groupNames = new Map<string, string>();
  const roster = new Map<string, string>();
  let bumps = 0;
  const groupEventIds = new Map<string, string>();
  let rosterEventId: string | undefined;

  // The relay assigns strictly increasing created_at so the connector's
  // "newest wins" roster/metadata resolution picks the latest write. Real time
  // is unavailable in some harnesses and would risk ties, so use a counter.
  const nextCreatedAt = () => 1_700_000_000 + bumps++;

  const upsertGroup = (id: string, name: string): void => {
    groupNames.set(id, name);
    const prior = groupEventIds.get(id);
    if (prior) stored.delete(prior);
    const event = finalizeEvent(
      {
        content: "",
        created_at: nextCreatedAt(),
        kind: GROUP_METADATA_KIND,
        tags: [
          ["d", id],
          ["name", name],
        ],
      },
      relayKey,
    );
    stored.set(event.id, event);
    groupEventIds.set(id, event.id);
    pushToSubscribers(event, subscriptions);
  };

  const writeRoster = (): void => {
    if (rosterEventId) stored.delete(rosterEventId);
    const event = finalizeEvent(
      {
        content: "",
        created_at: nextCreatedAt(),
        kind: ROSTER_KIND,
        tags: [...roster].map(([pubkey, role]) => ["p", pubkey, role]),
      },
      relayKey,
    );
    stored.set(event.id, event);
    rosterEventId = event.id;
    pushToSubscribers(event, subscriptions);
  };

  for (const group of groups) {
    upsertGroup(group.id, group.name);
  }

  const server: Server = createServer({ cert: tlsCert, key: tlsKey });
  // The bridge redeems a pasted invite by POSTing to the relay's HTTP
  // /api/invites/claim (NIP-98 signed). The real contract lives on the Buzz
  // relay, not this repo; here we only need a 2xx so the signer-free
  // begin-from-invite flow can run end to end. WS upgrades are handled
  // separately by WebSocketServer's own 'upgrade' listener, so this plain
  // request handler never sees them.
  server.on("request", (req, res) => {
    if (req.method === "POST" && req.url === "/api/invites/claim") {
      req.resume();
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (socket: WebSocket) => {
    subscriptions.set(socket, new Map());
    socket.on("message", (raw) => {
      handleMessage(socket, raw.toString(), {
        roster,
        stored,
        subscriptions,
        upsertGroup,
        writeRoster,
      });
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
      roster.clear();
      for (const member of members) roster.set(member.pubkey, member.role);
      writeRoster();
    },
    channels() {
      return [...groupNames].map(([id, name]) => ({ id, name }));
    },
    roster() {
      return [...roster].map(([pubkey, role]) => ({ pubkey, role }));
    },
  };
}

interface RelayContext {
  roster: Map<string, string>;
  stored: Map<string, Event>;
  subscriptions: Map<WebSocket, Map<string, RelayFilter[]>>;
  upsertGroup(id: string, name: string): void;
  writeRoster(): void;
}

function handleMessage(
  socket: WebSocket,
  raw: string,
  ctx: RelayContext,
): void {
  const { stored, subscriptions } = ctx;
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
    applyGroupManagement(event, ctx);
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

/**
 * Model the two NIP-29 group-management kinds the bridge uses to stand up a
 * dedicated channel, so a test sees their EFFECTS rather than a bare ACK:
 *   - 9007 create-group -> the group becomes listable (kind-39000 metadata),
 *     named from the `name` tag (falling back to its id);
 *   - 9000 put-user -> the named pubkey's role lands in the community roster,
 *     so promoting the requester to owner and demoting the bot to member are
 *     both visible to readRoster().
 */
function applyGroupManagement(event: Event, ctx: RelayContext): void {
  const groupId = event.tags.find((tag) => tag[0] === "h")?.[1];
  if (event.kind === GROUP_CREATE_KIND) {
    if (!groupId) return;
    const name = event.tags.find((tag) => tag[0] === "name")?.[1];
    ctx.upsertGroup(groupId, name && name.trim() ? name.trim() : groupId);
    return;
  }
  if (event.kind === GROUP_PUT_USER_KIND) {
    const member = event.tags.find((tag) => tag[0] === "p");
    const pubkey = member?.[1];
    const role = member?.[2];
    if (!pubkey || !role) return;
    ctx.roster.set(pubkey, role.toLowerCase());
    ctx.writeRoster();
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
