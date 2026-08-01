import { getPublicKey, verifyEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BuilderlabClient,
  buildBindingEvent,
  type BuilderlabChallenge,
  type BuilderlabClientConfig,
} from "./builderlab-client";
import {
  createHostedCommunity,
  decryptHostedIdentityKey,
  type CreateHostedCommunityDeps,
  type PersistedHostedCustody,
} from "./create-community";

const FIXED_NOW = Date.parse("2026-07-31T21:50:00.000Z");
const ORIGIN = "https://fake.builderlab.test";
const BASE_URL = "https://fake.builderlab.test/api/goose";
const SESSION = "s".repeat(43);
const WRAPPING_KEY = Buffer.alloc(32, 7);

interface RecordedRequest {
  body: Record<string, unknown>;
  headers: Record<string, string>;
  path: string;
}

type Responder = (
  path: string,
  body: Record<string, unknown>,
) => { status?: number; json: unknown };

function freshChallenge(
  overrides: Partial<BuilderlabChallenge> = {},
): BuilderlabChallenge {
  return {
    action: "bind_nostr_identity",
    audience: "buzz:nostr-identity",
    challenge_id: "84615b46-5f29-4e37-8e7d-5cc9e100e962",
    expires_at: new Date(FIXED_NOW + 5 * 60_000).toISOString(),
    kind: 24_243,
    nonce: "4AHQGA4g7UEcxZ4wuqLjAWT_3NwTUwyFDLOl_Y6nwKc",
    origin: ORIGIN,
    protocol: "buzz-nostr-identity",
    verification_code: "873083",
    version: "1",
    ...overrides,
  };
}

/** A fake Builderlab endpoint that records every request it receives. */
function fakeBuilderlab(respond: Responder): {
  config: BuilderlabClientConfig;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.slice(BASE_URL.length);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({
      body,
      headers: init.headers as Record<string, string>,
      path,
    });
    const { status = 200, json } = respond(path, body);
    return new Response(JSON.stringify(json), {
      headers: { "content-type": "application/json" },
      status,
    });
  }) as unknown as typeof fetch;

  return {
    config: {
      baseUrl: BASE_URL,
      fetch: fetchImpl,
      now: () => FIXED_NOW,
      origin: ORIGIN,
    },
    requests,
  };
}

/** Happy-path responder: availability → challenge → verify → create succeed. */
function happyResponder(
  challenge: BuilderlabChallenge = freshChallenge(),
): Responder {
  return (path, body) => {
    if (path === "/v1/buzz/communities/availability") {
      return {
        json: {
          available: true,
          normalized_host: `${body.name}.communities.buzz.xyz`,
        },
      };
    }
    if (path === "/v1/buzz/nostr-identities/challenge") {
      return { json: challenge };
    }
    if (path === "/v1/buzz/nostr-identities/verify") {
      // The bind proof must be a valid kind-24243 event for THIS challenge.
      const event = JSON.parse(String(body.signed_payload));
      expect(verifyEvent(event)).toBe(true);
      expect(event.kind).toBe(24_243);
      expect(event.tags[0]).toEqual(["challenge_id", challenge.challenge_id]);
      return {
        json: {
          correlation_id: "6b94606b-9334-404c-bec5-8ebb2c3dc016",
          identity: {
            npub: `npub1${event.pubkey.slice(0, 8)}`,
            pubkey_hex: event.pubkey,
          },
        },
      };
    }
    if (path === "/v1/buzz/communities") {
      return {
        json: {
          community: {
            id: "cbfe16b2-8dd4-4a43-bd47-fae9a5fdb953",
            normalized_host: `${body.name}.communities.buzz.xyz`,
            owner_pubkey: "pending",
          },
        },
      };
    }
    throw new Error(`unexpected path ${path}`);
  };
}

function makeDeps(
  config: BuilderlabClientConfig,
  persisted: PersistedHostedCustody[] = [],
  onPersist?: (record: PersistedHostedCustody) => void,
): CreateHostedCommunityDeps {
  return {
    client: new BuilderlabClient(config),
    persistCustody: async (record) => {
      onPersist?.(record);
      persisted.push(record);
    },
    wrappingKeys: { getKey: async () => WRAPPING_KEY },
  };
}

describe("buildBindingEvent", () => {
  it("emits the exact kind-24243 tag order the contract requires", () => {
    const challenge = freshChallenge();
    const secret = new Uint8Array(32).fill(3);
    const event = buildBindingEvent(secret, challenge, 1_785_534_663);

    expect(event.kind).toBe(24_243);
    expect(event.content).toBe("");
    expect(event.tags).toEqual([
      ["challenge_id", challenge.challenge_id],
      ["nonce", challenge.nonce],
      ["verification_code", challenge.verification_code],
      ["audience", challenge.audience],
      ["action", challenge.action],
      ["protocol", challenge.protocol],
      ["version", challenge.version],
      ["origin", challenge.origin],
      ["expires_at", challenge.expires_at],
    ]);
    expect(verifyEvent(event)).toBe(true);
  });
});

describe("createHostedCommunity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("binds a self-generated key and returns encrypted custody", async () => {
    const { config, requests } = fakeBuilderlab(happyResponder());
    const persisted: PersistedHostedCustody[] = [];
    const result = await createHostedCommunity(
      { name: "selfkeyproof0731", sessionCredential: SESSION },
      makeDeps(config, persisted),
    );

    expect(result.community.normalized_host).toBe(
      "selfkeyproof0731.communities.buzz.xyz",
    );
    // Custody decrypts back to a valid 32-byte secret whose pubkey is the id.
    const secret = decryptHostedIdentityKey(
      result.custody!,
      WRAPPING_KEY,
      result.bindPubkey,
    );
    expect(secret.byteLength).toBe(32);
    expect(getPublicKey(secret)).toBe(result.bindPubkey);
    expect(result.identity.pubkey_hex).toBe(result.bindPubkey);

    // Availability is pre-checked before the irreversible bind.
    expect(requests.map((r) => r.path)).toEqual([
      "/v1/buzz/communities/availability",
      "/v1/buzz/nostr-identities/challenge",
      "/v1/buzz/nostr-identities/verify",
      "/v1/buzz/communities",
    ]);
    for (const request of requests) {
      expect(request.headers["x-bb-session-credential"]).toBe(SESSION);
      expect(request.headers.origin).toBe(ORIGIN);
    }
  });

  it("persists the encrypted key BEFORE the bind (F1)", async () => {
    let pathsAtPersist: string[] = [];
    const { config, requests } = fakeBuilderlab(happyResponder());
    await createHostedCommunity(
      { name: "ordered", sessionCredential: SESSION },
      makeDeps(config, [], () => {
        pathsAtPersist = requests.map((r) => r.path);
      }),
    );

    // At persist time, only availability had been called — never verify/create.
    expect(pathsAtPersist).toEqual(["/v1/buzz/communities/availability"]);
    expect(pathsAtPersist).not.toContain("/v1/buzz/nostr-identities/verify");
  });

  it("rejects a bad name before generating or binding a key (F1)", async () => {
    const { config, requests } = fakeBuilderlab(happyResponder());
    const persisted: PersistedHostedCustody[] = [];
    await expect(
      createHostedCommunity(
        { name: "Bad_Name", sessionCredential: SESSION },
        makeDeps(config, persisted),
      ),
    ).rejects.toMatchObject({ code: "invalid_community_name" });

    // No live call, no key persisted — nothing was bound.
    expect(requests).toHaveLength(0);
    expect(persisted).toHaveLength(0);
  });

  it("pre-empts a taken name before binding (F2)", async () => {
    const { config, requests } = fakeBuilderlab((path, body) => {
      if (path === "/v1/buzz/communities/availability") {
        return { json: { available: false, normalized_host: "x" } };
      }
      return happyResponder()(path, body);
    });
    await expect(
      createHostedCommunity(
        { name: "taken", sessionCredential: SESSION },
        makeDeps(config),
      ),
    ).rejects.toMatchObject({ code: "community_name_taken" });

    // Only availability ran — the identity was never bound.
    expect(requests.map((r) => r.path)).toEqual([
      "/v1/buzz/communities/availability",
    ]);
  });

  it("keeps the key recoverable when create fails after a good bind (F1/F2)", async () => {
    const { config, requests } = fakeBuilderlab((path, body) => {
      if (path === "/v1/buzz/communities") {
        return { json: { error: "server_blip" }, status: 500 };
      }
      return happyResponder()(path, body);
    });
    const persisted: PersistedHostedCustody[] = [];

    await expect(
      createHostedCommunity(
        { name: "orphaned", sessionCredential: SESSION },
        makeDeps(config, persisted),
      ),
    ).rejects.toMatchObject({ code: "builderlab_rejected" });

    // The bind happened AND the key was persisted first, so it is recoverable.
    expect(requests.map((r) => r.path)).toContain(
      "/v1/buzz/nostr-identities/verify",
    );
    expect(persisted).toHaveLength(1);
    const recovered = decryptHostedIdentityKey(
      persisted[0].custody,
      WRAPPING_KEY,
      persisted[0].bindPubkey,
    );
    expect(getPublicKey(recovered)).toBe(persisted[0].bindPubkey);
  });

  it("resumes with the persisted key and tolerates identity_already_bound (F2)", async () => {
    // First attempt: create fails after bind, leaving a persisted, bound key.
    const first = fakeBuilderlab((path, body) => {
      if (path === "/v1/buzz/communities") {
        return { json: { error: "server_blip" }, status: 500 };
      }
      return happyResponder()(path, body);
    });
    const persisted: PersistedHostedCustody[] = [];
    await expect(
      createHostedCommunity(
        { name: "resume-me", sessionCredential: SESSION },
        makeDeps(first.config, persisted),
      ),
    ).rejects.toMatchObject({ code: "builderlab_rejected" });

    const record = persisted[0];
    const recovered = decryptHostedIdentityKey(
      record.custody,
      WRAPPING_KEY,
      record.bindPubkey,
    );

    // Second attempt: same session is already bound to OUR key; create succeeds.
    const second = fakeBuilderlab((path, body) => {
      if (path === "/v1/buzz/nostr-identities/verify") {
        return { json: { error: "identity_already_bound" }, status: 409 };
      }
      if (path === "/v1/buzz/nostr-identities/current") {
        return {
          json: {
            identity: { npub: record.npub, pubkey_hex: record.bindPubkey },
          },
        };
      }
      return happyResponder()(path, body);
    });

    const result = await createHostedCommunity(
      {
        existingSecretKey: recovered,
        name: "resume-me",
        sessionCredential: SESSION,
      },
      makeDeps(second.config, []),
    );

    expect(result.identity.pubkey_hex).toBe(record.bindPubkey);
    expect(result.community.normalized_host).toBe(
      "resume-me.communities.buzz.xyz",
    );
    // Resume confirmed the bound key via /current, then created the community.
    expect(second.requests.map((r) => r.path)).toEqual([
      "/v1/buzz/communities/availability",
      "/v1/buzz/nostr-identities/challenge",
      "/v1/buzz/nostr-identities/verify",
      "/v1/buzz/nostr-identities/current",
      "/v1/buzz/communities",
    ]);
  });

  it("refuses to proceed if the session is bound to a DIFFERENT key", async () => {
    const { config } = fakeBuilderlab((path, body) => {
      if (path === "/v1/buzz/nostr-identities/verify") {
        return { json: { error: "identity_already_bound" }, status: 409 };
      }
      if (path === "/v1/buzz/nostr-identities/current") {
        return { json: { identity: { pubkey_hex: "f".repeat(64) } } };
      }
      return happyResponder()(path, body);
    });

    await expect(
      createHostedCommunity(
        { name: "wedged", sessionCredential: SESSION },
        makeDeps(config),
      ),
    ).rejects.toMatchObject({ code: "identity_bound_to_other_key" });
  });

  it("fails fast on an expired challenge without calling /verify", async () => {
    const expired = freshChallenge({
      expires_at: new Date(FIXED_NOW - 60_000).toISOString(),
    });
    const { config, requests } = fakeBuilderlab(happyResponder(expired));

    await expect(
      createHostedCommunity(
        { name: "late", sessionCredential: SESSION },
        makeDeps(config),
      ),
    ).rejects.toMatchObject({ code: "challenge_expired" });

    expect(requests.map((r) => r.path)).not.toContain(
      "/v1/buzz/nostr-identities/verify",
    );
  });

  it("surfaces a /verify rejection and creates no community", async () => {
    const { config, requests } = fakeBuilderlab((path, body) => {
      if (path === "/v1/buzz/nostr-identities/verify") {
        return { json: { error: "signature_invalid" }, status: 401 };
      }
      return happyResponder()(path, body);
    });

    await expect(
      createHostedCommunity(
        { name: "rejected", sessionCredential: SESSION },
        makeDeps(config),
      ),
    ).rejects.toMatchObject({ code: "builderlab_rejected" });

    expect(requests.some((r) => r.path === "/v1/buzz/communities")).toBe(false);
  });

  it("never logs the secret nor puts it in any request or custody plaintext", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }

    const { config, requests } = fakeBuilderlab(happyResponder());
    const persisted: PersistedHostedCustody[] = [];
    const result = await createHostedCommunity(
      { name: "quiet", sessionCredential: SESSION },
      makeDeps(config, persisted),
    );

    // Recover the real secret from custody, then prove it leaked nowhere.
    const secretHex = decryptHostedIdentityKey(
      result.custody!,
      WRAPPING_KEY,
      result.bindPubkey,
    ).toString("hex");
    expect(secretHex).toMatch(/^[0-9a-f]{64}$/);

    expect(JSON.stringify(requests)).not.toContain(secretHex);
    expect(JSON.stringify(persisted)).not.toContain(secretHex);
    expect(logs.join("\n")).not.toContain(secretHex);
  });
});
