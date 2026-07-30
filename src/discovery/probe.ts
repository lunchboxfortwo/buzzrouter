import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { performance } from "node:perf_hooks";

import WebSocket from "ws";

import { classifyBuzzRelay, type BuzzClassification } from "./classifier";
import {
  DiscoveryError,
  type DiscoveryErrorCode,
  toDiscoveryError,
} from "./errors";
import {
  type AddressResolver,
  type PublicAddress,
  resolvePublicAddresses,
} from "./network-policy";
import {
  hashPublicIcon,
  parseNip11Document,
  type Nip11Document,
} from "./nip11";
import { normalizeRelayUrl } from "./normalize";

const CONNECT_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 5_000;
const NIP11_BODY_LIMIT_BYTES = 256 * 1024;
const WEBSOCKET_PAYLOAD_LIMIT_BYTES = 1024 * 1024;

export interface SuccessfulRelayProbe {
  ok: true;
  canonicalRelayUrl: string;
  httpStatus: number;
  websocketOpenMs: number;
  tlsValid: true;
  nip11: Nip11Document;
  iconHash: string | null;
  classification: BuzzClassification;
}

export interface FailedRelayProbe {
  ok: false;
  canonicalRelayUrl: string;
  resultCode: DiscoveryErrorCode;
}

export type RelayProbeResult = SuccessfulRelayProbe | FailedRelayProbe;

export interface ProbeDependencies {
  fetchNip11?: typeof fetchNip11;
  openWebsocket?: typeof openWebsocket;
  resolveAddresses?: AddressResolver;
}

export async function probeRelay(
  candidateUrl: string,
  dependencies: ProbeDependencies = {},
): Promise<RelayProbeResult> {
  const normalized = normalizeRelayUrl(candidateUrl);
  const resolver = dependencies.resolveAddresses ?? resolvePublicAddresses;
  const fetcher = dependencies.fetchNip11 ?? fetchNip11;
  const websocketProbe = dependencies.openWebsocket ?? openWebsocket;

  try {
    const { document, status } = await fetcher(
      normalized.canonicalRelayUrl,
      resolver,
    );
    const websocket = await websocketProbe(
      normalized.canonicalRelayUrl,
      resolver,
    );

    return {
      ok: true,
      canonicalRelayUrl: normalized.canonicalRelayUrl,
      httpStatus: status,
      websocketOpenMs: websocket.openMs,
      tlsValid: true,
      nip11: document,
      iconHash: hashPublicIcon(document.icon),
      classification: classifyBuzzRelay(document, true),
    };
  } catch (error) {
    const safeError = toDiscoveryError(
      error,
      "ws_failed",
      "Relay probe failed.",
    );

    return {
      ok: false,
      canonicalRelayUrl: normalized.canonicalRelayUrl,
      resultCode: safeError.code,
    };
  }
}

export async function fetchNip11(
  canonicalRelayUrl: string,
  resolveAddresses: AddressResolver = resolvePublicAddresses,
): Promise<{ document: Nip11Document; status: number }> {
  const relayUrl = new URL(canonicalRelayUrl);
  const addresses = await resolveAddresses(stripIpv6Brackets(relayUrl.hostname));
  const pinned = addresses[0];
  const target = new URL(canonicalRelayUrl);
  target.protocol = "https:";
  target.pathname = "/info";
  target.search = "";
  target.hash = "";

  const response = await requestBoundedJson(target, pinned);
  let parsed: unknown;

  try {
    parsed = JSON.parse(response.body);
  } catch (error) {
    throw new DiscoveryError(
      "invalid_nip11",
      "Relay information is not valid JSON.",
      { cause: error },
    );
  }

  return {
    document: parseNip11Document(parsed),
    status: response.status,
  };
}

export async function openWebsocket(
  canonicalRelayUrl: string,
  resolveAddresses: AddressResolver = resolvePublicAddresses,
): Promise<{ openMs: number }> {
  const relayUrl = new URL(canonicalRelayUrl);
  const addresses = await resolveAddresses(stripIpv6Brackets(relayUrl.hostname));
  const pinned = addresses[0];
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(canonicalRelayUrl, {
      followRedirects: false,
      handshakeTimeout: CONNECT_TIMEOUT_MS,
      lookup: createPinnedLookup(pinned),
      maxPayload: WEBSOCKET_PAYLOAD_LIMIT_BYTES,
      perMessageDeflate: false,
      rejectUnauthorized: true,
    });

    const totalTimer = setTimeout(() => {
      fail(new DiscoveryError("ws_timeout", "WebSocket probe timed out."));
    }, TOTAL_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(totalTimer);
      socket.removeAllListeners();
    };

    const fail = (error: DiscoveryError) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.terminate();
      reject(error);
    };

    socket.once("open", () => {
      if (settled) {
        return;
      }

      settled = true;
      const openMs = Math.max(0, Math.round(performance.now() - startedAt));
      cleanup();
      socket.close();
      resolve({ openMs });
    });

    socket.once("unexpected-response", () => {
      fail(
        new DiscoveryError(
          "ws_failed",
          "Relay rejected the WebSocket handshake.",
        ),
      );
    });

    socket.once("error", (error) => {
      fail(
        new DiscoveryError("ws_failed", "WebSocket connection failed.", {
          cause: error,
        }),
      );
    });
  });
}

function requestBoundedJson(
  target: URL,
  pinned: PublicAddress,
): Promise<{ body: string; status: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = httpsRequest(
      target,
      {
        headers: {
          accept: "application/nostr+json, application/json;q=0.9",
          "accept-encoding": "identity",
          "user-agent": "BuzzRouter-Discovery/0.1",
        },
        lookup: createPinnedLookup(pinned),
        method: "GET",
        rejectUnauthorized: true,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status !== 200) {
          response.resume();
          finishError(
            new DiscoveryError(
              "http_status",
              `Relay information returned HTTP ${status}.`,
            ),
          );
          return;
        }

        const chunks: Buffer[] = [];
        let bytes = 0;

        response.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > NIP11_BODY_LIMIT_BYTES) {
            response.destroy();
            finishError(
              new DiscoveryError(
                "response_too_large",
                "Relay information exceeded the response limit.",
              ),
            );
            return;
          }

          chunks.push(chunk);
        });

        response.once("end", () => {
          finishSuccess({
            body: Buffer.concat(chunks).toString("utf8"),
            status,
          });
        });

        response.once("error", (error) => {
          finishError(
            new DiscoveryError("invalid_nip11", "Relay response failed.", {
              cause: error,
            }),
          );
        });
      },
    );

    const totalTimer = setTimeout(() => {
      request.destroy();
      finishError(
        new DiscoveryError("http_timeout", "Relay information timed out."),
      );
    }, TOTAL_TIMEOUT_MS);

    request.setTimeout(CONNECT_TIMEOUT_MS, () => {
      request.destroy();
      finishError(
        new DiscoveryError("http_timeout", "Relay connection timed out."),
      );
    });

    request.once("error", (error) => {
      finishError(
        new DiscoveryError("invalid_nip11", "Relay request failed.", {
          cause: error,
        }),
      );
    });

    request.end();

    function finishSuccess(result: { body: string; status: number }) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(totalTimer);
      resolve(result);
    }

    function finishError(error: DiscoveryError) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(totalTimer);
      reject(error);
    }
  });
}

export function createPinnedLookup(pinned: PublicAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [pinned]);
      return;
    }

    callback(null, pinned.address, pinned.family);
  };
}

function stripIpv6Brackets(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
}
