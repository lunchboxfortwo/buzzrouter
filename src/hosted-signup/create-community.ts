import { npubEncode } from "nostr-tools/nip19";
import { generateSecretKey, getPublicKey } from "nostr-tools/pure";

import { ApiError } from "../http/api-error";
import {
  createFileWrappingKeyProvider,
  type WrappingKeyProvider,
} from "../shared-channels/connector";
import {
  decryptConnectorPrivateKey,
  encryptConnectorPrivateKey,
  type EncryptedConnectorKey,
} from "../shared-channels/store";
import {
  assertCommunityName,
  BuilderlabClient,
  resolveLiveBuilderlabConfig,
  type BuilderlabChallenge,
  type BuilderlabClientOptions,
  type BuilderlabCommunity,
  type BuilderlabIdentity,
} from "./builderlab-client";

const DEFAULT_WRAPPING_KEY_VERSION = 1;

/**
 * The secret key IS the community owner's identity. We never return, log, or
 * persist it in plaintext — the caller receives only this encrypted custody
 * record (AES-256-GCM, wrapped with a host key). Custody reuses the exact
 * connector-key encryption from `src/shared-channels/store.ts` rather than
 * inventing a second scheme.
 *
 * The AAD is the bind PUBKEY (not the community id) because the key must be
 * encrypted and persisted BEFORE the irreversible bind — at which point no
 * community exists yet. The pubkey is available the instant the key is
 * generated, and binds the ciphertext to the identity it is the secret for.
 */
export interface HostedIdentityCustody extends EncryptedConnectorKey {
  wrappingKeyVersion: number;
}

export function encryptHostedIdentityKey(
  secretKey: Uint8Array,
  wrappingKey: Uint8Array,
  bindPubkey: string,
): EncryptedConnectorKey {
  return encryptConnectorPrivateKey(secretKey, wrappingKey, bindPubkey);
}

/**
 * Recovers the plaintext secret from persisted custody so a wedged run can be
 * resumed (pass the result as `existingSecretKey`). Encapsulates the AAD
 * convention so callers never need to know it is the bind pubkey.
 */
export function decryptHostedIdentityKey(
  custody: HostedIdentityCustody,
  wrappingKey: Uint8Array,
  bindPubkey: string,
): Buffer {
  return decryptConnectorPrivateKey(custody, wrappingKey, bindPubkey);
}

export interface PersistedHostedCustody {
  bindPubkey: string;
  custody: HostedIdentityCustody;
  npub: string;
}

export interface CreateHostedCommunityResult {
  bindPubkey: string;
  community: BuilderlabCommunity;
  /** Present on a fresh run; omitted on resume (already persisted by the caller). */
  custody?: HostedIdentityCustody;
  identity: BuilderlabIdentity;
}

export interface CreateHostedCommunityInput {
  name: string;
  /**
   * A Builderlab session credential from the single interactive OAuth login
   * (obtain it out of band via `BuilderlabClient.exchangeLoginCode`). This
   * module does NOT automate Auth0 — that is the one non-server-side step.
   */
  sessionCredential: string;
  /**
   * Resume a wedged run by reusing the EXACT key a prior attempt already
   * persisted and (maybe) bound, instead of generating a fresh one. Recover it
   * with `decryptHostedIdentityKey`. Required for recovery: a fresh key would
   * hit `identity_already_bound` on a session whose identity is already bound.
   */
  existingSecretKey?: Uint8Array;
  wrappingKeyVersion?: number;
}

export interface CreateHostedCommunityDeps {
  client: BuilderlabClient;
  /**
   * Durably store the encrypted key. Invoked and AWAITED BEFORE the bind on a
   * fresh run, so any failure after the bind can never lose the key — the
   * caller already holds recoverable ciphertext. Not called on resume (the key
   * is, by definition, already persisted).
   */
  persistCustody: (record: PersistedHostedCustody) => Promise<void>;
  wrappingKeys: WrappingKeyProvider;
}

/**
 * Runs the documented sequence against a Builderlab session, ORDERED so the
 * identity key can never be lost:
 *   1. validate the name + (fresh) load the wrapping key — all bind-independent,
 *      so a bad name / misconfig fails BEFORE anything is bound
 *   2. check availability — pre-empt the common "name taken" case before the
 *      irreversible bind
 *   3. (fresh) generate a key, encrypt it, and PERSIST it — before binding
 *   4. request a challenge, sign the kind-24243 event, POST /verify (bind)
 *   5. create the community owned by that key
 *
 * If any post-bind step fails, the encrypted key is already persisted, so the
 * caller can resume with `existingSecretKey`. A resume tolerates
 * `identity_already_bound` only after confirming (via `/current`) that the
 * bound identity is OUR key — otherwise it surfaces `identity_bound_to_other_key`
 * rather than silently mis-owning a community.
 */
export async function createHostedCommunity(
  input: CreateHostedCommunityInput,
  deps: CreateHostedCommunityDeps,
): Promise<CreateHostedCommunityResult> {
  const wrappingKeyVersion =
    input.wrappingKeyVersion ?? DEFAULT_WRAPPING_KEY_VERSION;
  // (F1) Everything bind-independent runs before any key is generated or bound.
  assertCommunityName(input.name);

  const resuming = input.existingSecretKey != null;
  const secretKey = resuming
    ? (input.existingSecretKey as Uint8Array)
    : generateSecretKey();
  const bindPubkey = getPublicKey(secretKey);
  const npub = npubEncode(bindPubkey);

  try {
    // (F2) Pre-empt the most common irreversible-loss trigger before binding.
    const availability = await deps.client.checkCommunityAvailability(
      input.sessionCredential,
      input.name,
    );
    if (!availability.available) {
      throw new ApiError(
        "community_name_taken",
        `The community name "${input.name}" is not available.`,
        409,
      );
    }

    let custody: HostedIdentityCustody | undefined;
    if (!resuming) {
      // (F1/F2) Encrypt + persist BEFORE the bind. After this line the key is
      // recoverable from durable storage no matter what fails downstream.
      const wrappingKey = await deps.wrappingKeys.getKey(wrappingKeyVersion);
      custody = {
        ...encryptHostedIdentityKey(secretKey, wrappingKey, bindPubkey),
        wrappingKeyVersion,
      };
      await deps.persistCustody({ bindPubkey, custody, npub });
    }

    const challenge = await deps.client.requestChallenge(
      input.sessionCredential,
    );
    const identity = await bindOrResume(
      deps.client,
      input.sessionCredential,
      secretKey,
      bindPubkey,
      npub,
      challenge,
    );
    const community = await deps.client.createCommunity(
      input.sessionCredential,
      input.name,
    );

    return { bindPubkey, community, custody, identity };
  } finally {
    // Zero only a key we generated; on resume the caller owns the buffer.
    if (!resuming) secretKey.fill(0);
  }
}

/**
 * Binds the key, tolerating an already-bound session ONLY when the bound
 * identity is confirmed to be ours. This is what makes a resume idempotent
 * without risking a community owned by a different (possibly lost) key.
 */
async function bindOrResume(
  client: BuilderlabClient,
  sessionCredential: string,
  secretKey: Uint8Array,
  bindPubkey: string,
  npub: string,
  challenge: BuilderlabChallenge,
): Promise<BuilderlabIdentity> {
  try {
    return await client.bindNostrIdentity(
      sessionCredential,
      secretKey,
      challenge,
    );
  } catch (error) {
    if (error instanceof ApiError && error.code === "identity_already_bound") {
      const current = await client.getCurrentIdentity(sessionCredential);
      if (current.pubkey_hex !== bindPubkey) {
        throw new ApiError(
          "identity_bound_to_other_key",
          "This session is already bound to a different Nostr identity.",
          409,
        );
      }
      return { npub, pubkey_hex: bindPubkey };
    }
    throw error;
  }
}

/**
 * Default dependency wiring for LIVE use. Refuses unless
 * `BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE=1` (see `resolveLiveBuilderlabConfig`).
 * `persistCustody` is required — recoverability depends on the caller supplying
 * durable storage for the encrypted key.
 */
export function createLiveHostedCommunityDeps(
  persistCustody: CreateHostedCommunityDeps["persistCustody"],
  clientOptions: BuilderlabClientOptions = {},
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
): CreateHostedCommunityDeps {
  return {
    client: new BuilderlabClient(resolveLiveBuilderlabConfig(clientOptions)),
    persistCustody,
    wrappingKeys,
  };
}
