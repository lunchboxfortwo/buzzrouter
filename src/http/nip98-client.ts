import { createHash, randomUUID } from "node:crypto";

import { finalizeEvent } from "nostr-tools/pure";

const NIP98_KIND = 27_235;

export interface Nip98Request {
  body?: string;
  method: string;
  url: string;
}

/**
 * Builds the value for an `authorization: Nostr <value>` header per NIP-98:
 * a signed kind-27235 event carrying the request URL, method, and a payload
 * hash. Mirrors the signing logic in scripts/signed-request.ts so an owner's
 * local CLI and a server-held bridge key produce identical proofs.
 */
export function signNip98(
  privateKey: Uint8Array,
  request: Nip98Request,
): string {
  const method = request.method.toUpperCase();
  const tags: string[][] = [
    ["u", request.url],
    ["method", method],
    ["nonce", randomUUID()],
  ];
  if (request.body !== undefined) {
    tags.push([
      "payload",
      createHash("sha256").update(request.body).digest("hex"),
    ]);
  }

  const event = finalizeEvent(
    {
      content: "",
      created_at: Math.floor(Date.now() / 1_000),
      kind: NIP98_KIND,
      tags,
    },
    privateKey,
  );
  return Buffer.from(JSON.stringify(event)).toString("base64");
}
