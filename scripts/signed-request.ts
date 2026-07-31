/**
 * Signs a NIP-98 request with a local key so community owners can administer
 * claims, listings, and shared channels without a browser signer extension.
 *
 * Usage:
 *   BUZZROUTER_ADMIN_KEY=<nsec... or 64-hex> \
 *   npm run admin -- <METHOD> <path> ['<json body>']
 *
 * The key never leaves this process; only the signed kind-27235 event is sent.
 */
import { createHash, randomUUID } from "node:crypto";

import { nip19 } from "nostr-tools";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";

const NIP98_KIND = 27_235;

function parseKey(raw: string | undefined): Uint8Array {
  if (!raw) {
    throw new Error(
      "BUZZROUTER_ADMIN_KEY is required (nsec1... or 64-character hex).",
    );
  }
  const value = raw.trim();
  if (value.startsWith("nsec")) {
    const decoded = nip19.decode(value);
    if (decoded.type !== "nsec") {
      throw new Error("BUZZROUTER_ADMIN_KEY is not an nsec key.");
    }
    return decoded.data;
  }
  if (!/^[0-9a-f]{64}$/i.test(value)) {
    throw new Error(
      "BUZZROUTER_ADMIN_KEY must be an nsec key or 64-character hex.",
    );
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

async function main(): Promise<void> {
  const [method, target, rawBody] = process.argv.slice(2);
  if (!method || !target) {
    throw new Error(
      "Usage: npm run admin -- <METHOD> <path> ['<json body>']",
    );
  }

  const secretKey = parseKey(process.env.BUZZROUTER_ADMIN_KEY);
  const origin =
    process.env.BUZZROUTER_ADMIN_ORIGIN ?? "https://buzzrouter.com";
  const url = new URL(target, origin).toString();
  const upperMethod = method.toUpperCase();
  const body =
    upperMethod === "GET" || rawBody === undefined ? undefined : rawBody;

  const tags = [
    ["u", url],
    ["method", upperMethod],
    ["nonce", randomUUID()],
  ];
  if (body !== undefined) {
    tags.push([
      "payload",
      createHash("sha256").update(body).digest("hex"),
    ]);
  }

  const event = finalizeEvent(
    {
      content: "",
      created_at: Math.floor(Date.now() / 1_000),
      kind: NIP98_KIND,
      tags,
    },
    secretKey,
  );
  const authorization = Buffer.from(JSON.stringify(event)).toString(
    "base64",
  );

  const response = await fetch(url, {
    body,
    headers: {
      authorization: `Nostr ${authorization}`,
      ...(body === undefined
        ? {}
        : { "content-type": "application/json" }),
    },
    method: upperMethod,
  });
  const text = await response.text();

  process.stderr.write(
    `${upperMethod} ${url} -> ${response.status} (signer ${getPublicKey(secretKey)})\n`,
  );
  process.stdout.write(`${text}\n`);
  if (!response.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
