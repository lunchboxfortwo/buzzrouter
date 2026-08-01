import { nsecEncode } from "nostr-tools/nip19";

import { ApiError } from "../http/api-error";
import type { WrappingKeyProvider } from "../shared-channels/connector";
import type { EncryptedConnectorKey } from "../shared-channels/store";

import {
  assertCommunityName,
  BuilderlabClient,
  type BuilderlabCommunity,
} from "./builderlab-client";
import {
  createHostedCommunity,
  decryptHostedIdentityKey,
  type HostedIdentityCustody,
} from "./create-community";
import {
  decryptSessionCredential,
  encryptSessionCredential,
} from "./session-custody";
import type { SignupDriver } from "./signup-driver";
import type { ProvisionCustodyRecord, ResumableProvision } from "./store";

const DEFAULT_WRAPPING_KEY_VERSION = 1;

export interface ProvisionHostedCommunityInput {
  name: string;
  /** Handover email — used only to reach the requester about the account. */
  contactEmail: string;
}

export interface ProvisionHostedCommunityResult {
  community: BuilderlabCommunity;
  /** Public URL the new community is served at. */
  communityUrl: string;
  host: string;
  npub: string;
  /**
   * The identity secret, nsec-encoded, returned ONCE so the requester genuinely
   * owns the community. Never persisted in plaintext, never logged. The caller
   * must show/offer it exactly once and not store it.
   */
  nsec: string;
  /** True when a prior wedged attempt was resumed instead of a fresh signup. */
  resumed: boolean;
}

export interface ProvisionHostedCommunityDeps {
  signupDriver: SignupDriver;
  client: BuilderlabClient;
  wrappingKeys: WrappingKeyProvider;
  /** Persist encrypted custody BEFORE the bind (awaited); see store.ts. */
  persistCustody: (record: ProvisionCustodyRecord) => Promise<void>;
  markCreated: (
    bindPubkey: string,
    community: { communityId: string; normalizedHost: string },
  ) => Promise<void>;
  /** Look up a resumable provision for this name, or null. */
  findResumable: (name: string) => Promise<ResumableProvision | null>;
  /** Ingest the new community into the directory (best-effort — see note). */
  listInDirectory: (input: {
    name: string;
    normalizedHost: string;
    contactEmail: string;
  }) => Promise<void>;
  /** Injectable clock (ms) so session-expiry checks are deterministic in tests. */
  now?: () => number;
  wrappingKeyVersion?: number;
}

/**
 * One-page "Create a community": provision an account, bind a self-generated
 * key, create the community, list it, and hand the requester their identity.
 *
 * Ordered for recoverability, mirroring `createHostedCommunity`:
 *   1. validate the name up front (cheap, bind-independent)
 *   2. try to RESUME a wedged prior attempt for this name (its account already
 *      exists; re-signing up would orphan it) before driving a fresh signup
 *   3. acquire a session (resume: reuse the persisted one; fresh: drive signup)
 *   4. run the bind→create sequence, persisting the encrypted key BEFORE the bind
 *   5. mark created, list in the directory, and return the one-time nsec export
 *
 * Every failure is an `ApiError` with a stable code so the page can show a
 * legible "we couldn't create it, here's how to do it yourself" instead of a
 * silent hang or a half-created community.
 */
export async function provisionHostedCommunity(
  input: ProvisionHostedCommunityInput,
  deps: ProvisionHostedCommunityDeps,
): Promise<ProvisionHostedCommunityResult> {
  assertCommunityName(input.name);
  const wrappingKeyVersion =
    deps.wrappingKeyVersion ?? DEFAULT_WRAPPING_KEY_VERSION;

  const resumable = await deps.findResumable(input.name);
  const resuming = resumable != null;

  // Acquire a session and (on resume) the exact prior key.
  let existingSecretKey: Uint8Array | undefined;
  let sessionCredential: string;
  // On a FRESH run these carry the session into persistCustody so it is stored
  // encrypted (making a post-bind failure resumable); on resume they stay null
  // because the session is already persisted.
  let sessionForPersist: string | null = null;
  let sessionExpiresAt: string | null = null;

  if (resumable) {
    const nowMs = (deps.now ?? Date.now)();
    if (
      !sessionUsable(resumable.sessionExpiresAt, nowMs) ||
      !resumable.session
    ) {
      // The account exists but we can no longer act on it (write-once login).
      // Fail loudly rather than silently orphaning or re-creating it.
      throw new ApiError(
        "provision_unresumable",
        "A previous attempt for this name is stuck and can no longer be " +
          "finished automatically. Contact support to recover it.",
        409,
      );
    }
    const wrappingKey = await deps.wrappingKeys.getKey(
      resumable.wrappingKeyVersion,
    );
    existingSecretKey = Uint8Array.from(
      decryptHostedIdentityKey(
        { ...resumable.secret, wrappingKeyVersion: resumable.wrappingKeyVersion },
        wrappingKey,
        resumable.bindPubkey,
      ),
    );
    sessionCredential = decryptSessionCredential(
      resumable.session,
      wrappingKey,
      resumable.bindPubkey,
    );
  } else {
    const session = await deps.signupDriver.acquireSession({
      email: input.contactEmail,
    });
    sessionCredential = session.sessionCredential;
    sessionForPersist = session.sessionCredential;
    sessionExpiresAt = session.expiresAt;
  }

  const result = await createHostedCommunity(
    {
      name: input.name,
      sessionCredential,
      existingSecretKey,
      wrappingKeyVersion,
    },
    {
      client: deps.client,
      wrappingKeys: deps.wrappingKeys,
      persistCustody: async ({ bindPubkey, custody, npub }) => {
        const encryptedSession = sessionForPersist
          ? await encryptSession(
              deps.wrappingKeys,
              wrappingKeyVersion,
              sessionForPersist,
              bindPubkey,
            )
          : null;
        await deps.persistCustody({
          bindPubkey,
          communityName: input.name,
          contactEmail: input.contactEmail,
          npub,
          secret: stripVersion(custody),
          session: encryptedSession,
          sessionExpiresAt,
          wrappingKeyVersion,
        });
      },
    },
  );

  await deps.markCreated(result.bindPubkey, {
    communityId: result.community.id,
    normalizedHost: result.community.normalized_host,
  });

  // Ingest into the directory so the community becomes discoverable (probed and
  // verified by the existing pipeline, exactly like a submission). Best-effort:
  // a directory hiccup must not fail a request whose community already exists.
  try {
    await deps.listInDirectory({
      contactEmail: input.contactEmail,
      name: input.name,
      normalizedHost: result.community.normalized_host,
    });
  } catch {
    // Swallowed intentionally — the community is real; listing can be retried.
  }

  // Recover the plaintext secret ONLY to produce the one-time nsec export.
  const wrappingKey = await deps.wrappingKeys.getKey(wrappingKeyVersion);
  const secret = existingSecretKey
    ? Buffer.from(existingSecretKey)
    : decryptHostedIdentityKey(
        { ...result.custody!, wrappingKeyVersion },
        wrappingKey,
        result.bindPubkey,
      );
  const nsec = nsecEncode(Uint8Array.from(secret));

  return {
    community: result.community,
    communityUrl: `https://${result.community.normalized_host}`,
    host: result.community.normalized_host,
    npub: result.identity.npub,
    nsec,
    resumed: resuming,
  };
}

function sessionUsable(expiresAt: string | null, nowMs: number): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return !Number.isNaN(ms) && ms > nowMs;
}

async function encryptSession(
  wrappingKeys: WrappingKeyProvider,
  version: number,
  sessionCredential: string,
  bindPubkey: string,
): Promise<EncryptedConnectorKey> {
  const wrappingKey = await wrappingKeys.getKey(version);
  return encryptSessionCredential(sessionCredential, wrappingKey, bindPubkey);
}

/** The store persists the three GCM buffers; drop the version wrapper. */
function stripVersion(custody: HostedIdentityCustody): EncryptedConnectorKey {
  return {
    authTag: custody.authTag,
    ciphertext: custody.ciphertext,
    nonce: custody.nonce,
  };
}
