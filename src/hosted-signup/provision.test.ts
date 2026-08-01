import { decode as decodeNip19 } from "nostr-tools/nip19";
import { getPublicKey, verifyEvent } from "nostr-tools/pure";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { WrappingKeyProvider } from "../shared-channels/connector";
import { decryptConnectorPrivateKey } from "../shared-channels/store";

import {
  BuilderlabClient,
  type BuilderlabChallenge,
  type BuilderlabClientConfig,
} from "./builderlab-client";
import { decryptHostedIdentityKey } from "./create-community";
import { provisionHostedCommunity } from "./provision";
import {
  buildCliLoginUrl,
  extractLoginCode,
  generateSignupPassword,
  type SignupDriver,
} from "./signup-driver";
import type {
  ProvisionCustodyRecord,
  ResumableProvision,
} from "./store";

const FIXED_NOW = Date.parse("2026-07-31T21:50:00.000Z");
const ORIGIN = "https://fake.builderlab.test";
const BASE_URL = "https://fake.builderlab.test/api/goose";
const SESSION = "s".repeat(43);
const WRAPPING_KEY = Buffer.alloc(32, 7);
const WRAPPING_KEYS: WrappingKeyProvider = { getKey: async () => WRAPPING_KEY };

function freshChallenge(): BuilderlabChallenge {
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
  };
}

type Responder = (
  path: string,
  body: Record<string, unknown>,
) => { status?: number; json: unknown };

interface Recorded {
  body: Record<string, unknown>;
  path: string;
}

function fakeBuilderlab(respond: Responder): {
  config: BuilderlabClientConfig;
  requests: Recorded[];
} {
  const requests: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.slice(BASE_URL.length);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({ body, path });
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

function happyResponder(): Responder {
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
      return { json: freshChallenge() };
    }
    if (path === "/v1/buzz/nostr-identities/verify") {
      const event = JSON.parse(String(body.signed_payload));
      expect(verifyEvent(event)).toBe(true);
      return {
        json: {
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

/** In-memory implementation of the provision store, keyed by bind pubkey. */
class MemoryStore {
  rows: (ProvisionCustodyRecord & {
    status: string;
    communityId?: string;
    normalizedHost?: string;
  })[] = [];

  persistCustody = async (record: ProvisionCustodyRecord): Promise<void> => {
    const existing = this.rows.find((r) => r.bindPubkey === record.bindPubkey);
    if (existing) {
      Object.assign(existing, record);
    } else {
      this.rows.push({ ...record, status: "pending" });
    }
  };

  markCreated = async (
    bindPubkey: string,
    community: { communityId: string; normalizedHost: string },
  ): Promise<void> => {
    const row = this.rows.find((r) => r.bindPubkey === bindPubkey);
    if (row) {
      row.status = "created";
      row.communityId = community.communityId;
      row.normalizedHost = community.normalizedHost;
      row.session = null;
    }
  };

  findResumable = async (name: string): Promise<ResumableProvision | null> => {
    const row = this.rows.find(
      (r) => r.communityName === name && r.status === "pending",
    );
    if (!row) return null;
    return {
      bindPubkey: row.bindPubkey,
      npub: row.npub,
      secret: row.secret,
      session: row.session,
      sessionExpiresAt: row.sessionExpiresAt,
      wrappingKeyVersion: row.wrappingKeyVersion,
    };
  };
}

function fakeDriver(
  session = { expiresAt: new Date(FIXED_NOW + 8 * 3_600_000).toISOString(), sessionCredential: SESSION },
): SignupDriver & { calls: number } {
  const driver = {
    calls: 0,
    acquireSession: async () => {
      driver.calls += 1;
      return session;
    },
  };
  return driver;
}

function deps(
  config: BuilderlabClientConfig,
  store: MemoryStore,
  driver: SignupDriver,
  listed: { name: string; normalizedHost: string; contactEmail: string }[] = [],
) {
  return {
    client: new BuilderlabClient(config),
    findResumable: store.findResumable,
    listInDirectory: async (input: {
      name: string;
      normalizedHost: string;
      contactEmail: string;
    }) => {
      listed.push(input);
    },
    markCreated: store.markCreated,
    now: () => FIXED_NOW,
    persistCustody: store.persistCustody,
    signupDriver: driver,
    wrappingKeys: WRAPPING_KEYS,
  };
}

describe("pure helpers", () => {
  it("buildCliLoginUrl encodes the CLI login params + returnTo", () => {
    const url = new URL(
      buildCliLoginUrl(ORIGIN, "http://127.0.0.1:1/cb?x=y"),
    );
    expect(url.pathname).toBe("/api/goose/v1/auth/login");
    expect(url.searchParams.get("type")).toBe("cli");
    expect(url.searchParams.get("product")).toBe("buzz");
    expect(url.searchParams.get("returnTo")).toBe("http://127.0.0.1:1/cb?x=y");
  });

  it("extractLoginCode reads ?code, throws when absent", () => {
    expect(extractLoginCode("http://127.0.0.1:1/cb?code=abc123")).toBe("abc123");
    expect(() => extractLoginCode("http://127.0.0.1:1/cb")).toThrow(
      /login code/i,
    );
  });

  it("generateSignupPassword is long and mixed-class", () => {
    const pw = generateSignupPassword();
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
    expect(pw).toMatch(/[^A-Za-z0-9]/);
    expect(generateSignupPassword()).not.toBe(pw);
  });
});

describe("provisionHostedCommunity", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("provisions end-to-end and returns a one-time nsec export (happy path)", async () => {
    const { config, requests } = fakeBuilderlab(happyResponder());
    const store = new MemoryStore();
    const driver = fakeDriver();
    const listed: { name: string; normalizedHost: string; contactEmail: string }[] =
      [];

    const result = await provisionHostedCommunity(
      { contactEmail: "owner@example.com", name: "brandnew" },
      deps(config, store, driver, listed),
    );

    expect(result.resumed).toBe(false);
    expect(result.host).toBe("brandnew.communities.buzz.xyz");
    expect(result.communityUrl).toBe(
      "https://brandnew.communities.buzz.xyz",
    );

    // The nsec decodes to the exact identity that owns the community.
    const decoded = decodeNip19(result.nsec);
    expect(decoded.type).toBe("nsec");
    const secret = decoded.data as Uint8Array;
    const pubkey = getPublicKey(secret);
    expect(result.npub).toContain(pubkey.slice(0, 8));

    // Custody was persisted (before the bind) and the row marked created.
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("created");
    // Custody decrypts back to that same key.
    const recovered = decryptHostedIdentityKey(
      { ...store.rows[0].secret, wrappingKeyVersion: 1 },
      WRAPPING_KEY,
      store.rows[0].bindPubkey,
    );
    expect(getPublicKey(recovered)).toBe(pubkey);

    // Directory ingest happened; signup ran exactly once.
    expect(listed).toEqual([
      {
        contactEmail: "owner@example.com",
        name: "brandnew",
        normalizedHost: "brandnew.communities.buzz.xyz",
      },
    ]);
    expect(driver.calls).toBe(1);
    expect(requests.map((r) => r.path)).toEqual([
      "/v1/buzz/communities/availability",
      "/v1/buzz/nostr-identities/challenge",
      "/v1/buzz/nostr-identities/verify",
      "/v1/buzz/communities",
    ]);
  });

  it("fails loudly when signup fails, binding nothing", async () => {
    const { config, requests } = fakeBuilderlab(happyResponder());
    const store = new MemoryStore();
    const failing: SignupDriver = {
      acquireSession: async () => {
        const { ApiError } = await import("../http/api-error");
        throw new ApiError("signup_automation_failed", "nope", 502);
      },
    };

    await expect(
      provisionHostedCommunity(
        { contactEmail: "owner@example.com", name: "willfail" },
        deps(config, store, failing),
      ),
    ).rejects.toMatchObject({ code: "signup_automation_failed" });

    expect(requests).toHaveLength(0);
    expect(store.rows).toHaveLength(0);
  });

  it("is resumable: a bind failure after signup can be finished without re-signup", async () => {
    let verifyShouldFail = true;
    const build = () =>
      fakeBuilderlab((path, body) => {
        if (path === "/v1/buzz/nostr-identities/verify" && verifyShouldFail) {
          return { json: { error: "signature_invalid" }, status: 401 };
        }
        return happyResponder()(path, body);
      });

    const store = new MemoryStore();
    const driver = fakeDriver();

    // First attempt: signup succeeds, /verify fails → rejects, but custody +
    // session are persisted (before the bind).
    const first = build();
    await expect(
      provisionHostedCommunity(
        { contactEmail: "owner@example.com", name: "resume-me" },
        deps(first.config, store, driver),
      ),
    ).rejects.toMatchObject({ code: "builderlab_rejected" });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0].status).toBe("pending");
    expect(store.rows[0].session).not.toBeNull();
    expect(driver.calls).toBe(1);

    // Second attempt: /verify now succeeds. It should RESUME from the persisted
    // key + session — no fresh signup.
    verifyShouldFail = false;
    const second = build();
    const result = await provisionHostedCommunity(
      { contactEmail: "owner@example.com", name: "resume-me" },
      deps(second.config, store, driver),
    );

    expect(result.resumed).toBe(true);
    expect(driver.calls).toBe(1); // NOT called again
    expect(store.rows[0].status).toBe("created");
    expect(second.requests.map((r) => r.path)).toContain(
      "/v1/buzz/nostr-identities/verify",
    );
  });

  it("refuses to resume when the persisted session has expired", async () => {
    const { config } = fakeBuilderlab(happyResponder());
    const store = new MemoryStore();
    // A stuck prior attempt whose session already lapsed.
    const driver = fakeDriver({
      expiresAt: new Date(FIXED_NOW - 60_000).toISOString(),
      sessionCredential: SESSION,
    });
    const failVerify = fakeBuilderlab((path, body) => {
      if (path === "/v1/buzz/nostr-identities/verify") {
        return { json: { error: "signature_invalid" }, status: 401 };
      }
      return happyResponder()(path, body);
    });
    await expect(
      provisionHostedCommunity(
        { contactEmail: "owner@example.com", name: "stuck" },
        deps(failVerify.config, store, driver),
      ),
    ).rejects.toMatchObject({ code: "builderlab_rejected" });

    // Now the row is pending but the session is expired → unresumable.
    await expect(
      provisionHostedCommunity(
        { contactEmail: "owner@example.com", name: "stuck" },
        deps(config, store, driver),
      ),
    ).rejects.toMatchObject({ code: "provision_unresumable" });
  });

  it("never leaks the secret or session credential into the store or logs", async () => {
    const logs: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        logs.push(args.map(String).join(" "));
      });
    }

    const { config } = fakeBuilderlab(happyResponder());
    const store = new MemoryStore();
    const result = await provisionHostedCommunity(
      { contactEmail: "owner@example.com", name: "quiet" },
      deps(config, store, fakeDriver()),
    );

    const secretHex = Buffer.from(
      decodeNip19(result.nsec).data as Uint8Array,
    ).toString("hex");
    expect(secretHex).toMatch(/^[0-9a-f]{64}$/);

    // The plaintext secret appears nowhere in the persisted rows or the logs.
    const rowsJson = JSON.stringify(store.rows);
    expect(rowsJson).not.toContain(secretHex);
    expect(logs.join("\n")).not.toContain(secretHex);
    // The session credential is stored only as ciphertext.
    expect(rowsJson).not.toContain(SESSION);
    expect(logs.join("\n")).not.toContain(SESSION);
    // But the encrypted session IS recoverable (proves it was actually stored).
    // (row is marked created, which clears the session — so check before that is
    // covered by the resumable test; here we just assert no plaintext leak.)
  });
});
