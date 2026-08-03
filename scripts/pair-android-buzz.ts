/**
 * Pair the existing Android emulator with a throwaway Buzz identity.
 *
 * This implements the source (desktop) half of Buzz's NIP-AB pairing flow as
 * accepted by mobile/lib/features/pairing at block/buzz dcd74a2:
 *
 *   1. Generate an in-memory identity, an ephemeral pairing key, and a
 *      32-byte session secret. Subscribe to kind 24134 events addressed to the
 *      ephemeral source key on the dedicated pairing relay.
 *   2. Paste a nostrpair:// URI into the already-installed Android app. The URI
 *      itself is never printed or written to disk.
 *   3. Decrypt mobile's NIP-44 offer, derive and compare the six-digit SAS,
 *      then send sas-confirm followed by the custom desktop payload
 *      {relayUrl,pubkey,nsec}.
 *   4. Tap mobile's confirmation only after its rendered SAS matches, and wait
 *      for complete(success=true).
 *
 * The pairing relay uses NIP-42. AUTH events are kind 22242 and are signed by
 * the ephemeral pairing key, never by the imported identity. All private key
 * bytes stay in this process and are zeroed on exit where JavaScript permits;
 * no nsec, session secret, QR URI, ciphertext, or receipt is logged.
 *
 * Usage:
 *   node --import tsx scripts/pair-android-buzz.ts \
 *     --identity-relay https://buzzdir.communities.buzz.xyz \
 *     [--serial emulator-5554] [--evidence-dir /tmp/buzz-pair-evidence]
 */
import { execFile, spawn } from "node:child_process";
import {
  createECDH,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import { nip19 } from "nostr-tools";
import { decrypt, encrypt, getConversationKey } from "nostr-tools/nip44";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
  verifyEvent,
  type Event,
  type EventTemplate,
} from "nostr-tools/pure";
import WebSocket from "ws";

const execFileAsync = promisify(execFile);
const PAIRING_KIND = 24_134;
const AUTH_KIND = 22_242;
const DEFAULT_PAIRING_RELAY = "wss://pairing.buzz.xyz";
const DEFAULT_PACKAGE = "xyz.block.buzz.mobile";

type RelayMessage = unknown[];

export function deriveSessionId(sessionSecret: Uint8Array): Uint8Array {
  return hkdf(sessionSecret, new Uint8Array(), "nostr-pair-session-id");
}

export function deriveSas(
  sourcePrivateKey: Uint8Array,
  targetPublicKeyHex: string,
  sessionSecret: Uint8Array,
): { code: string; input: Uint8Array } {
  const ecdh = createECDH("secp256k1");
  ecdh.setPrivateKey(sourcePrivateKey);
  const compressedTarget = Buffer.concat([
    Buffer.from([0x02]),
    Buffer.from(targetPublicKeyHex, "hex"),
  ]);
  const shared = ecdh.computeSecret(compressedTarget);
  try {
    const input = hkdf(shared, sessionSecret, "nostr-pair-sas-v1");
    const code = (input[0]! * 0x1000000 + input[1]! * 0x10000 +
      input[2]! * 0x100 + input[3]!) % 1_000_000;
    return { code: code.toString().padStart(6, "0"), input };
  } finally {
    shared.fill(0);
  }
}

export function deriveTranscriptHash(args: {
  sessionId: Uint8Array;
  sourcePublicKeyHex: string;
  targetPublicKeyHex: string;
  sasInput: Uint8Array;
  sessionSecret: Uint8Array;
}): Uint8Array {
  const transcript = Buffer.concat([
    args.sessionId,
    Buffer.from(args.sourcePublicKeyHex, "hex"),
    Buffer.from(args.targetPublicKeyHex, "hex"),
    args.sasInput,
  ]);
  try {
    return hkdf(
      transcript,
      args.sessionSecret,
      "nostr-pair-transcript-v1",
    );
  } finally {
    transcript.fill(0);
  }
}

export function pairingUri(args: {
  sourcePublicKeyHex: string;
  sessionSecret: Uint8Array;
  pairingRelay: string;
}): string {
  const query = new URLSearchParams({
    secret: Buffer.from(args.sessionSecret).toString("hex"),
    relay: args.pairingRelay,
    v: "1",
  });
  return `nostrpair://${args.sourcePublicKeyHex}?${query.toString()}`;
}

function hkdf(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
): Uint8Array {
  return new Uint8Array(
    hkdfSync("sha256", ikm, salt, Buffer.from(info, "utf8"), 32),
  );
}

class MessageQueue {
  private readonly queued: RelayMessage[] = [];
  private wake: (() => void) | undefined;

  push(message: RelayMessage): void {
    this.queued.push(message);
    this.wake?.();
    this.wake = undefined;
  }

  async next(timeoutMs: number): Promise<RelayMessage> {
    const deadline = Date.now() + timeoutMs;
    while (this.queued.length === 0) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error("Timed out waiting for pairing relay");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.wake = undefined;
          reject(new Error("Timed out waiting for pairing relay"));
        }, remaining);
        this.wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
    return this.queued.shift()!;
  }
}

export class PairingRelay {
  private readonly queue = new MessageQueue();
  private socket: WebSocket | undefined;

  constructor(
    private readonly url: string,
    private readonly sourcePrivateKey: Uint8Array,
  ) {}

  async connect(): Promise<void> {
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.on("message", (raw) => {
      try {
        const parsed = JSON.parse(raw.toString());
        if (Array.isArray(parsed)) this.queue.push(parsed);
      } catch {
        // Nostr relays occasionally emit non-protocol notices. Ignore them.
      }
    });
    // Without this, a dropped socket is indistinguishable from a peer that
    // simply never spoke: both surface as the queue's generic timeout, so a
    // pairing that failed at the transport reads as "the phone never answered".
    socket.on("close", () => this.queue.push(["__SOCKET_CLOSED__"]));
    await new Promise<void>((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
    });

    const authDeadline = Date.now() + 4_000;
    while (Date.now() < authDeadline) {
      let message: RelayMessage;
      try {
        message = await this.queue.next(authDeadline - Date.now());
      } catch {
        return; // auth-free relay
      }
      if (message[0] !== "AUTH" || typeof message[1] !== "string") continue;
      const auth = finalizeEvent(
        {
          kind: AUTH_KIND,
          created_at: Math.floor(Date.now() / 1000),
          content: "",
          tags: [
            ["relay", this.url],
            ["challenge", message[1]],
          ],
        },
        this.sourcePrivateKey,
      );
      this.send(["AUTH", auth]);
      await this.waitForOk(auth.id, 8_000);
      return;
    }
  }

  async subscribe(sourcePublicKeyHex: string): Promise<void> {
    this.send([
      "REQ",
      "pair",
      { kinds: [PAIRING_KIND], "#p": [sourcePublicKeyHex] },
    ]);
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      const message = await this.queue.next(deadline - Date.now());
      if (message[0] === "EOSE" && message[1] === "pair") return;
      if (message[0] === "CLOSED" && message[1] === "pair") {
        throw new Error(`Pairing subscription closed: ${String(message[2])}`);
      }
    }
    throw new Error("Pairing relay did not acknowledge the subscription");
  }

  async waitForPairingEvent(timeoutMs: number): Promise<Event> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = await this.queue.next(deadline - Date.now());
      if (message[0] === "__SOCKET_CLOSED__") {
        throw new Error("Pairing relay dropped the connection");
      }
      if (message[0] !== "EVENT" || message[1] !== "pair") continue;
      const event = message[2];
      if (typeof event !== "object" || event === null) continue;
      if (verifyEvent(event as Event)) return event as Event;
    }
    throw new Error("Timed out waiting for the mobile pairing event");
  }

  async publish(event: Event): Promise<void> {
    this.send(["EVENT", event]);
    await this.waitForOk(event.id, 10_000);
  }

  close(): void {
    this.socket?.close();
    this.socket = undefined;
  }

  private send(message: RelayMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("Pairing relay is not connected");
    }
    this.socket.send(JSON.stringify(message));
  }

  private async waitForOk(eventId: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const message = await this.queue.next(deadline - Date.now());
      if (message[0] !== "OK" || message[1] !== eventId) continue;
      if (message[2] === true) return;
      throw new Error(`Pairing relay rejected an event: ${String(message[3])}`);
    }
    throw new Error("Pairing relay did not acknowledge an event");
  }
}

async function adb(serial: string, ...args: string[]): Promise<string> {
  try {
    const result = await execFileAsync("adb", ["-s", serial, ...args], {
      maxBuffer: 4 * 1024 * 1024,
    });
    return result.stdout;
  } catch {
    // execFile errors include the full command. One adb command carries the
    // secret-bearing pairing URI, so never propagate the original error.
    throw new Error(`adb ${args[0] ?? "command"} failed (details redacted)`);
  }
}

async function uiXml(serial: string): Promise<string> {
  return adb(serial, "exec-out", "uiautomator", "dump", "/dev/tty");
}

async function adbShellStdin(serial: string, command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    // Keep secret-bearing commands off the host process list. The command is
    // written to an interactive adb shell over stdin, never placed in argv.
    const child = spawn("adb", ["-s", serial, "shell"], {
      stdio: ["pipe", "ignore", "ignore"],
    });
    child.once("error", () =>
      reject(new Error("adb shell failed (details redacted)")),
    );
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error("adb shell failed (details redacted)"));
    });
    child.stdin.end(`${command}\n`);
  });
}

function centerOfNode(
  xml: string,
  predicate: (attributes: string) => boolean,
): { x: number; y: number } | undefined {
  for (const match of xml.matchAll(/<node\s+([^>]+)\/>/g)) {
    const attributes = match[1]!;
    if (!predicate(attributes)) continue;
    const bounds = attributes.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
    if (!bounds) continue;
    return {
      x: Math.round((Number(bounds[1]) + Number(bounds[3])) / 2),
      y: Math.round((Number(bounds[2]) + Number(bounds[4])) / 2),
    };
  }
  return undefined;
}

async function tapNode(
  serial: string,
  predicate: (attributes: string) => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const point = centerOfNode(await uiXml(serial), predicate);
    if (point) {
      await adb(serial, "shell", "input", "tap", String(point.x), String(point.y));
      return;
    }
    await delay(300);
  }
  throw new Error("Timed out waiting for the expected Buzz control");
}

async function waitForText(
  serial: string,
  text: string,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const xml = await uiXml(serial);
    if (xml.includes(text)) return;
    await delay(300);
  }
  throw new Error(`Buzz did not render the expected non-secret text: ${text}`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function pastePairingUri(args: {
  serial: string;
  packageName: string;
  uri: string;
}): Promise<void> {
  await adb(args.serial, "shell", "am", "force-stop", args.packageName);
  await adb(
    args.serial,
    "shell",
    "monkey",
    "-p",
    args.packageName,
    "1",
  );
  await tapNode(args.serial, (node) => node.includes('content-desc="Use pairing code"'));
  await tapNode(args.serial, (node) => node.includes('class="android.widget.EditText"'));
  // Flutter opens the software keyboard asynchronously. Injecting immediately
  // can lose the first character, producing `ostrpair://…` with no visible
  // error. Verify the exact value in memory before allowing Connect.
  await delay(1_000);
  let pasted = false;
  for (let attempt = 0; attempt < 3 && !pasted; attempt += 1) {
    if (attempt > 0) {
      await adb(args.serial, "shell", "input", "keycombination", "113", "29");
      await adb(args.serial, "shell", "input", "keyevent", "67");
      await delay(300);
    }
    // Pass a single quoted command to Android's remote shell. The URI only
    // lives in this process and the app's field; it never enters stdout/stderr.
    await adbShellStdin(args.serial, `input text ${shellQuote(args.uri)}`);
    await delay(300);
    pasted = editTextValue(await uiXml(args.serial)) === args.uri;
  }
  if (!pasted) throw new Error("Android did not accept the complete pairing URI");
  await tapNode(args.serial, (node) => node.includes('content-desc="Connect"'));
}

function editTextValue(xml: string): string | undefined {
  const node = [...xml.matchAll(/<node\s+([^>]+)\/>/g)].find((match) =>
    match[1]?.includes('class="android.widget.EditText"'),
  );
  const encoded = node?.[1]?.match(/text="([^"]*)"/)?.[1];
  return encoded
    ?.replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

export function addressedTo(event: Event, publicKeyHex: string): boolean {
  return event.kind === PAIRING_KIND &&
    event.tags.some((tag) => tag[0] === "p" && tag[1] === publicKeyHex);
}

export function pairingEvent(args: {
  sourcePrivateKey: Uint8Array;
  targetPublicKeyHex: string;
  conversationKey: Uint8Array;
  message: Record<string, unknown>;
}): Event {
  const template: EventTemplate = {
    kind: PAIRING_KIND,
    created_at: Math.floor(Date.now() / 1000) - Math.floor(Math.random() * 31),
    tags: [["p", args.targetPublicKeyHex]],
    content: encrypt(JSON.stringify(args.message), args.conversationKey),
  };
  return finalizeEvent(template, args.sourcePrivateKey);
}

async function screenshot(serial: string, path: string): Promise<void> {
  const result = await execFileAsync(
    "adb",
    ["-s", serial, "exec-out", "screencap", "-p"],
    { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 },
  );
  await writeFile(path, result.stdout);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv: string[]): {
  identityRelay: string;
  pairingRelay: string;
  serial: string;
  evidenceDir?: string;
} {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Arguments must be --name value pairs");
    }
    values.set(key, value);
  }
  const identityRelay = values.get("--identity-relay");
  if (!identityRelay) throw new Error("Missing --identity-relay https://…");
  const parsedIdentity = new URL(identityRelay);
  if (parsedIdentity.protocol !== "https:") {
    throw new Error("--identity-relay must use https://");
  }
  const pairingRelay = values.get("--pairing-relay") ?? DEFAULT_PAIRING_RELAY;
  if (new URL(pairingRelay).protocol !== "wss:") {
    throw new Error("--pairing-relay must use wss://");
  }
  return {
    identityRelay: parsedIdentity.toString().replace(/\/$/, ""),
    pairingRelay,
    serial: values.get("--serial") ?? "emulator-5554",
    evidenceDir: values.get("--evidence-dir"),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const identityPrivateKey = generateSecretKey();
  const sourcePrivateKey = generateSecretKey();
  const sessionSecret = randomBytes(32);
  const sourcePublicKeyHex = getPublicKey(sourcePrivateKey);
  const sessionId = deriveSessionId(sessionSecret);
  const relay = new PairingRelay(options.pairingRelay, sourcePrivateKey);

  try {
    console.log(`# Pairing Buzz on ${options.serial} with a throwaway identity`);
    await adb(options.serial, "get-state");
    await adb(options.serial, "shell", "pm", "path", DEFAULT_PACKAGE);
    await relay.connect();
    console.log("1. Pairing relay authenticated with an ephemeral key.");
    await relay.subscribe(sourcePublicKeyHex);
    console.log("2. Source subscription is active.");

    const uri = pairingUri({
      sourcePublicKeyHex,
      sessionSecret,
      pairingRelay: options.pairingRelay,
    });
    await pastePairingUri({
      serial: options.serial,
      packageName: DEFAULT_PACKAGE,
      uri,
    });
    console.log("3. Pairing URI pasted into Buzz (value redacted).");

    let offer: Event | undefined;
    const offerDeadline = Date.now() + 120_000;
    while (Date.now() < offerDeadline) {
      const candidate = await relay.waitForPairingEvent(offerDeadline - Date.now());
      if (addressedTo(candidate, sourcePublicKeyHex)) {
        offer = candidate;
        break;
      }
    }
    if (!offer) throw new Error("Mobile did not send a valid pairing offer");
    const targetPublicKeyHex = offer.pubkey;
    const conversationKey = getConversationKey(
      sourcePrivateKey,
      targetPublicKeyHex,
    );
    const offerMessage = JSON.parse(
      decrypt(offer.content, conversationKey),
    ) as Record<string, unknown>;
    if (
      offerMessage.type !== "offer" ||
      offerMessage.version !== 1 ||
      offerMessage.session_id !== Buffer.from(sessionId).toString("hex")
    ) {
      throw new Error("Mobile sent an invalid pairing offer");
    }

    const sas = deriveSas(
      sourcePrivateKey,
      targetPublicKeyHex,
      sessionSecret,
    );
    await waitForText(
      options.serial,
      `${sas.code.slice(0, 3)} ${sas.code.slice(3)}`,
      15_000,
    );
    console.log(`4. Mobile and source SAS match (${sas.code}).`);
    const transcriptHash = deriveTranscriptHash({
      sessionId,
      sourcePublicKeyHex,
      targetPublicKeyHex,
      sasInput: sas.input,
      sessionSecret,
    });

    await relay.publish(
      pairingEvent({
        sourcePrivateKey,
        targetPublicKeyHex,
        conversationKey,
        message: {
          type: "sas-confirm",
          transcript_hash: Buffer.from(transcriptHash).toString("hex"),
        },
      }),
    );
    const identityPublicKeyHex = getPublicKey(identityPrivateKey);
    const payload = JSON.stringify({
      relayUrl: options.identityRelay,
      pubkey: identityPublicKeyHex,
      nsec: nip19.nsecEncode(identityPrivateKey),
    });
    await relay.publish(
      pairingEvent({
        sourcePrivateKey,
        targetPublicKeyHex,
        conversationKey,
        message: { type: "payload", payload_type: "custom", payload },
      }),
    );
    await tapNode(
      options.serial,
      (node) =>
        node.includes('content-desc="Codes Match"') ||
        node.includes('content-desc="Code matches"'),
    );
    console.log("5. Identity payload sent; mobile SAS confirmation tapped.");

    const completeDeadline = Date.now() + 60_000;
    let completed = false;
    while (Date.now() < completeDeadline) {
      const event = await relay.waitForPairingEvent(completeDeadline - Date.now());
      if (event.pubkey !== targetPublicKeyHex || !addressedTo(event, sourcePublicKeyHex)) {
        continue;
      }
      const message = JSON.parse(
        decrypt(event.content, conversationKey),
      ) as Record<string, unknown>;
      if (message.type === "abort") {
        throw new Error(`Mobile aborted pairing: ${String(message.reason)}`);
      }
      if (message.type === "complete") {
        completed = message.success === true;
        break;
      }
    }
    if (!completed) throw new Error("Mobile failed to import the pairing payload");
    await waitForText(options.serial, "Channels", 30_000).catch(() => undefined);
    if (options.evidenceDir) {
      await mkdir(options.evidenceDir, { recursive: true });
      await screenshot(
        options.serial,
        `${options.evidenceDir}/paired-buzz.png`,
      );
    }
    console.log(
      `6. Pairing complete. Imported public key ${identityPublicKeyHex.slice(0, 12)}…; no secret was emitted.`,
    );
  } finally {
    relay.close();
    identityPrivateKey.fill(0);
    sourcePrivateKey.fill(0);
    sessionSecret.fill(0);
    sessionId.fill(0);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      "Pairing failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  });
}
