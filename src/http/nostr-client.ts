"use client";

interface BrowserNostrProvider {
  getPublicKey(): Promise<string>;
  signEvent(event: {
    content: string;
    created_at: number;
    kind: number;
    tags: string[][];
  }): Promise<Record<string, unknown>>;
}

export function getBrowserNostrProvider(): BrowserNostrProvider | null {
  return (
    window as Window & { nostr?: BrowserNostrProvider }
  ).nostr ?? null;
}

export async function signedRequest<T>(
  path: string,
  method: "GET" | "POST",
  value?: unknown,
): Promise<T> {
  const nostr = getBrowserNostrProvider();
  if (!nostr) {
    throw new Error("A Nostr signer is required.");
  }

  const body = method === "GET" ? undefined : JSON.stringify(value ?? {});
  const url = new URL(path, window.location.origin).toString();
  const tags = [
    ["u", url],
    ["method", method],
    ["nonce", crypto.randomUUID()],
  ];
  if (body !== undefined) {
    tags.push(["payload", await sha256Hex(body)]);
  }
  const event = await nostr.signEvent({
    content: "",
    created_at: Math.floor(Date.now() / 1_000),
    kind: 27_235,
    tags,
  });
  const authorization = bytesToBase64(
    new TextEncoder().encode(JSON.stringify(event)),
  );
  const response = await fetch(url, {
    body,
    headers: {
      authorization: `Nostr ${authorization}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    method,
  });
  const result = (await response.json()) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(result.message ?? result.error ?? "Request failed.");
  }
  return result;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}
