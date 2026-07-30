import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";

import {
  type CandidateSource,
  upsertCandidate,
} from "../db/candidates";
import { DiscoveryError } from "../discovery/errors";
import { normalizeRelayUrl } from "../discovery/normalize";
import { enqueueCandidateProbe } from "../jobs/queues";

export interface SourceCandidate {
  relayUrl: string;
  source: CandidateSource;
}

type IngestionRejectionReason =
  | "invalid_url"
  | "unsupported_scheme"
  | "embedded_credentials"
  | "invalid_host";

export type IngestionResult =
  | {
      accepted: true;
      candidateId: string;
    }
  | {
      accepted: false;
      reason: IngestionRejectionReason;
    };

export async function ingestSourceCandidate(
  pool: Pool,
  boss: PgBoss,
  input: SourceCandidate,
): Promise<IngestionResult> {
  let relay;
  try {
    relay = normalizeRelayUrl(input.relayUrl);
  } catch (error) {
    if (
      error instanceof DiscoveryError &&
      isIngestionRejection(error.code)
    ) {
      return {
        accepted: false,
        reason: error.code,
      };
    }

    throw error;
  }

  const candidate = await upsertCandidate(pool, relay, input.source);
  await enqueueCandidateProbe(boss, candidate.id);

  return {
    accepted: true,
    candidateId: candidate.id,
  };
}

function isIngestionRejection(
  code: string,
): code is IngestionRejectionReason {
  return [
    "invalid_url",
    "unsupported_scheme",
    "embedded_credentials",
    "invalid_host",
  ].includes(code);
}
