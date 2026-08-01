import { generateSecretKey } from "nostr-tools/pure";

import {
  createFileWrappingKeyProvider,
  type WrappingKeyProvider,
} from "../shared-channels/connector";
import {
  encryptConnectorPrivateKey,
  type EncryptedConnectorKey,
} from "../shared-channels/store";
import {
  BuilderlabClient,
  resolveLiveBuilderlabConfig,
  type BuilderlabClientOptions,
  type BuilderlabCommunity,
  type BuilderlabIdentity,
} from "./builderlab-client";

const DEFAULT_WRAPPING_KEY_VERSION = 1;

/**
 * The secret key IS the community owner's identity. We never return, log, or
 * persist it in plaintext — the caller receives only this encrypted custody
 * record (AES-256-GCM, wrapped with a host key), scoped to the created
 * community. Custody reuses the exact connector-key encryption from
 * `src/shared-channels/store.ts` (`encryptConnectorPrivateKey`) rather than
 * inventing a second scheme; the community id is the AAD, so the ciphertext is
 * bound to the identity it owns.
 */
export interface HostedIdentityCustody extends EncryptedConnectorKey {
  wrappingKeyVersion: number;
}

export interface CreateHostedCommunityResult {
  community: BuilderlabCommunity;
  custody: HostedIdentityCustody;
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
  wrappingKeyVersion?: number;
}

export interface CreateHostedCommunityDeps {
  client: BuilderlabClient;
  wrappingKeys: WrappingKeyProvider;
}

/**
 * Runs the full documented sequence against a Builderlab session:
 *   1. generate a Nostr keypair (server-side)
 *   2. request a binding challenge
 *   3. build + sign the kind-24243 event and POST /verify (bind the identity)
 *   4. create the hosted community owned by that key
 *   5. encrypt the secret key at rest, scoped to the new community, and zero
 *      the plaintext
 *
 * Deps are injected so tests drive a fake Builderlab endpoint; the default
 * factory wires the live client (opt-in) + the host wrapping-key file.
 */
export async function createHostedCommunity(
  input: CreateHostedCommunityInput,
  deps: CreateHostedCommunityDeps,
): Promise<CreateHostedCommunityResult> {
  const wrappingKeyVersion =
    input.wrappingKeyVersion ?? DEFAULT_WRAPPING_KEY_VERSION;
  const secretKey = generateSecretKey();
  try {
    const challenge = await deps.client.requestChallenge(
      input.sessionCredential,
    );
    const identity = await deps.client.bindNostrIdentity(
      input.sessionCredential,
      secretKey,
      challenge,
    );
    const community = await deps.client.createCommunity(
      input.sessionCredential,
      input.name,
    );

    const wrappingKey = await deps.wrappingKeys.getKey(wrappingKeyVersion);
    const encrypted = encryptConnectorPrivateKey(
      secretKey,
      wrappingKey,
      community.id,
    );
    return {
      community,
      custody: { ...encrypted, wrappingKeyVersion },
      identity,
    };
  } finally {
    secretKey.fill(0);
  }
}

/**
 * Default dependency wiring for LIVE use. Refuses unless
 * `BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE=1` (see `resolveLiveBuilderlabConfig`),
 * so nothing here reaches the real service without an explicit opt-in.
 */
export function createLiveHostedCommunityDeps(
  clientOptions: BuilderlabClientOptions = {},
  wrappingKeys: WrappingKeyProvider = createFileWrappingKeyProvider(),
): CreateHostedCommunityDeps {
  return {
    client: new BuilderlabClient(resolveLiveBuilderlabConfig(clientOptions)),
    wrappingKeys,
  };
}
