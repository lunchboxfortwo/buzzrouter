/**
 * Pair a PHYSICAL phone with a fresh Buzz identity.
 *
 * `pair-android-buzz.ts` drives an emulator over adb: it pastes the pairing URI
 * with `input text`, reads the SAS off the screen, and taps "Codes Match"
 * itself. A real handset has none of that, so this variant keeps the protocol
 * half verbatim and replaces the adb half with a human.
 *
 * DELIBERATE DEVIATION: the emulator script never emits the nostrpair:// URI,
 * because it never has to. Here the URI IS the deliverable — the human types it
 * into their phone — so it is printed. The URI carries the 32-byte session
 * secret, so anyone who sees it during the live window can answer the offer in
 * the phone's place. That is bounded here because the identity is generated
 * fresh in this process and owns nothing until it is granted membership AFTER
 * a successful pair. Do not reuse this script to move an identity that matters.
 *
 * The nsec is still never printed and never written to disk. It exists only in
 * this process and in the NIP-44 payload addressed to the phone.
 *
 * Usage:
 *   node --import tsx scripts/pair-phone-buzz.ts \
 *     --identity-relay https://relay.buzzrouter.com
 */
import { randomBytes } from "node:crypto";

import { nip19 } from "nostr-tools";
import { decrypt, getConversationKey } from "nostr-tools/nip44";
import { generateSecretKey, getPublicKey, type Event } from "nostr-tools/pure";

import {
  addressedTo,
  deriveSas,
  deriveSessionId,
  deriveTranscriptHash,
  pairingEvent,
  PairingRelay,
  pairingUri,
} from "./pair-android-buzz";

const DEFAULT_PAIRING_RELAY = "wss://pairing.buzz.xyz";
// A human has to read a URI onto a phone. The emulator's 120s assumes a robot.
const OFFER_TIMEOUT_MS = 600_000;
// MEASURED: pairing.buzz.xyz closes EVERY socket at ~120s (CLOSE 1005 at
// +120428ms idle, and again at +125401ms while re-issuing REQ every 45s). It is
// a hard connection lifetime, not an idle timer — client traffic does not reset
// it. Kind 24134 is ephemeral, so the relay replays nothing: a socket that is
// down when the phone publishes loses the offer permanently.
//
// Overlapping two connections to cover the gap is NOT possible: the relay
// answers a second REQ for the same pubkey with
// "error: #p already has a live subscriber". One subscriber per p-tag, full
// stop. So the only option is to reconnect AFTER the relay hangs up, which
// leaves a real (~1s) blind spot per cycle. The phone publishes its offer
// immediately after the human taps Connect, so a miss just means retrying —
// it is not silent corruption.
const RESUBSCRIBE_BACKOFF_MS = 1_000;

/** One subscription, re-established each time the relay enforces its cap. */
class ReconnectingSubscription {
  private relay: PairingRelay | undefined;

  constructor(
    private readonly url: string,
    private readonly sourcePrivateKey: Uint8Array,
    private readonly sourcePublicKeyHex: string,
  ) {}

  async start(): Promise<void> {
    const relay = new PairingRelay(this.url, this.sourcePrivateKey);
    await relay.connect();
    await relay.subscribe(this.sourcePublicKeyHex);
    this.relay = relay;
  }

  current(): PairingRelay {
    if (!this.relay) throw new Error("Pairing subscription is not started");
    return this.relay;
  }

  async waitForOffer(timeoutMs: number): Promise<Event> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      try {
        // Wait almost the full connection cap. A shorter window would make the
        // loop tear down and re-subscribe on its own timeout, multiplying the
        // ~1s blind spot for no reason; the relay's own close is the signal we
        // actually want to react to.
        const event = await this.current().waitForPairingEvent(
          Math.min(110_000, deadline - Date.now()),
        );
        if (addressedTo(event, this.sourcePublicKeyHex)) return event;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (!message.includes("dropped") && !message.includes("Timed out")) {
          throw error;
        }
        // Either the relay hit its connection cap or nothing arrived in this
        // window. Both are recoverable; rebuild the subscription and wait on.
        this.close();
        await new Promise((resolve) =>
          setTimeout(resolve, RESUBSCRIBE_BACKOFF_MS),
        );
        await this.start();
      }
    }
    throw new Error("Phone did not send a pairing offer in time");
  }

  close(): void {
    this.relay?.close();
    this.relay = undefined;
  }
}

function parseArgs(argv: string[]): {
  identityRelay: string;
  pairingRelay: string;
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
  const parsed = new URL(identityRelay);
  if (parsed.protocol !== "https:") {
    throw new Error("--identity-relay must use https://");
  }
  const pairingRelay = values.get("--pairing-relay") ?? DEFAULT_PAIRING_RELAY;
  if (new URL(pairingRelay).protocol !== "wss:") {
    throw new Error("--pairing-relay must use wss://");
  }
  return {
    identityRelay: parsed.toString().replace(/\/$/, ""),
    pairingRelay,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const identityPrivateKey = generateSecretKey();
  const sourcePrivateKey = generateSecretKey();
  const sessionSecret = randomBytes(32);
  const sourcePublicKeyHex = getPublicKey(sourcePrivateKey);
  const identityPublicKeyHex = getPublicKey(identityPrivateKey);
  const sessionId = deriveSessionId(sessionSecret);
  const relay = new ReconnectingSubscription(
    options.pairingRelay,
    sourcePrivateKey,
    sourcePublicKeyHex,
  );

  try {
    await relay.start();
    console.log(`IDENTITY_PUBKEY ${identityPublicKeyHex}`);
    console.log(`IDENTITY_RELAY  ${options.identityRelay}`);
    console.log("");
    console.log("PASTE_THIS_ON_PHONE");
    console.log(
      pairingUri({
        sourcePublicKeyHex,
        sessionSecret,
        pairingRelay: options.pairingRelay,
      }),
    );
    console.log("");
    console.log("WAITING_FOR_OFFER");

    const offer = await relay.waitForOffer(OFFER_TIMEOUT_MS);
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
      throw new Error("Phone sent an invalid pairing offer");
    }

    const sas = deriveSas(sourcePrivateKey, targetPublicKeyHex, sessionSecret);
    console.log(`SAS ${sas.code.slice(0, 3)} ${sas.code.slice(3)}`);
    console.log("");
    console.log(
      "Compare that against the phone. Tap 'Codes Match' ONLY if identical.",
    );

    const transcriptHash = deriveTranscriptHash({
      sessionId,
      sourcePublicKeyHex,
      targetPublicKeyHex,
      sasInput: sas.input,
      sessionSecret,
    });
    await relay.current().publish(
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
    await relay.current().publish(
      pairingEvent({
        sourcePrivateKey,
        targetPublicKeyHex,
        conversationKey,
        message: {
          type: "payload",
          payload_type: "custom",
          payload: JSON.stringify({
            relayUrl: options.identityRelay,
            pubkey: identityPublicKeyHex,
            nsec: nip19.nsecEncode(identityPrivateKey),
          }),
        },
      }),
    );
    console.log("PAYLOAD_SENT — waiting for the phone to confirm import.");

    const completeDeadline = Date.now() + 300_000;
    let completed = false;
    while (Date.now() < completeDeadline) {
      const event = await relay.current().waitForPairingEvent(
        completeDeadline - Date.now(),
      );
      if (
        event.pubkey !== targetPublicKeyHex ||
        !addressedTo(event, sourcePublicKeyHex)
      ) {
        continue;
      }
      const message = JSON.parse(
        decrypt(event.content, conversationKey),
      ) as Record<string, unknown>;
      if (message.type === "abort") {
        throw new Error(`Phone aborted pairing: ${String(message.reason)}`);
      }
      if (message.type === "complete") {
        completed = message.success === true;
        break;
      }
    }
    if (!completed) throw new Error("Phone failed to import the pairing payload");
    console.log(`PAIRED ${identityPublicKeyHex}`);
  } finally {
    relay.close();
    identityPrivateKey.fill(0);
    sourcePrivateKey.fill(0);
    sessionSecret.fill(0);
    sessionId.fill(0);
  }
}

main().catch((error) => {
  console.error(
    "Pairing failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
