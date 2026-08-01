import type { Pool } from "pg";

import { upsertCandidate } from "../db/candidates";
import { normalizeRelayUrl } from "../discovery/normalize";
import {
  createFileWrappingKeyProvider,
  type WrappingKeyProvider,
} from "../shared-channels/connector";

import {
  BuilderlabClient,
  resolveLiveBuilderlabConfig,
  type BuilderlabClientOptions,
} from "./builderlab-client";
import type { ProvisionHostedCommunityDeps } from "./provision";
import { PlaywrightSignupDriver, type SignupDriver } from "./signup-driver";
import {
  findResumableProvision,
  markProvisionCreated,
  persistProvisionCustody,
} from "./store";

export interface LiveProvisionOptions extends BuilderlabClientOptions {
  /** Public origin used as the directory source locator. */
  publicOrigin: string;
  /** Override the signup driver (used to keep the live path off in tests). */
  signupDriver?: SignupDriver;
  wrappingKeys?: WrappingKeyProvider;
}

/**
 * LIVE dependency wiring for `provisionHostedCommunity`, backed by Postgres and
 * a real browser-driven signup. Everything network-facing is gated by
 * `BUZZROUTER_HOSTED_SIGNUP_ALLOW_LIVE=1` (enforced inside
 * `resolveLiveBuilderlabConfig` / `PlaywrightSignupDriver`), so this cannot be
 * constructed into a live-egress state without the flag.
 */
export function createLiveProvisionDeps(
  pool: Pool,
  options: LiveProvisionOptions,
): ProvisionHostedCommunityDeps {
  const wrappingKeys = options.wrappingKeys ?? createFileWrappingKeyProvider();
  const client = new BuilderlabClient(resolveLiveBuilderlabConfig(options));
  const signupDriver =
    options.signupDriver ?? new PlaywrightSignupDriver(options);

  return {
    client,
    signupDriver,
    wrappingKeys,
    persistCustody: (record) => persistProvisionCustody(pool, record),
    markCreated: (bindPubkey, community) =>
      markProvisionCreated(pool, bindPubkey, community),
    findResumable: (name) => findResumableProvision(pool, name),
    listInDirectory: async ({ name, normalizedHost, contactEmail }) => {
      // Ingest the hosted community as a candidate; the discovery pipeline probes
      // and verifies it into the public directory exactly like a submission.
      const relay = normalizeRelayUrl(`wss://${normalizedHost}`);
      await upsertCandidate(pool, relay, {
        evidenceId: relay.canonicalRelayUrl,
        listing: { contactEmail, displayName: name },
        locator: `${options.publicOrigin}/create-community`,
        type: "submission",
      });
    },
  };
}
