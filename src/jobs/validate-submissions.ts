import type { Pool } from "pg";

import {
  upsertCandidate as defaultUpsertCandidate,
  type CandidateRecord,
  type CandidateSource,
} from "../db/candidates";
import { upsertMembership } from "../db/presence";
import {
  claimPendingValidations,
  resolveSubmissionValidation,
} from "../db/submission-validations";
import { normalizeRelayUrl, type NormalizedRelay } from "../discovery/normalize";
import { loadAgentIdentity } from "../presence/identity";
import {
  joinCommunity as defaultJoinCommunity,
  type JoinCommunityOptions,
  type JoinCommunityResult,
} from "../presence/policy";
import { isAlreadyMember } from "./auto-join-communities";

/**
 * Synchronous invite validation, run by the worker (which holds the agent key —
 * the internet-facing web tier never does). The web route inserts a pending
 * `submission_validations` row when a submission carries an invite; this poller
 * claims those rows and settles each by the only reliable test the relay offers:
 * actually claiming the invite as the agent. That doubles as getting our agent
 * INTO the community, so a valid invite both verifies AND joins in one step.
 *
 *   - join ok / already a member → ingest the community as a `submission`
 *     candidate carrying the code, record membership, mark the row `valid`.
 *   - claim rejected              → mark `invalid` with the bare reason.
 *   - transport/unexpected error  → mark `error`.
 *
 * The web request polls the row for that verdict. Every row is handled under its
 * own try/catch so one bad invite never stalls the batch, and only the host
 * (never the code, receipt, or key) is logged.
 */

export type JoinCommunityFn = (
  options: JoinCommunityOptions,
) => Promise<JoinCommunityResult>;

export type InjectCandidateFn = (
  pool: Pool,
  relay: NormalizedRelay,
  source: CandidateSource,
) => Promise<CandidateRecord>;

export interface ValidateSubmissionsDeps {
  pool: Pool;
  /** Injectable join; defaults to the real policy handshake as the agent. */
  joinImpl?: JoinCommunityFn;
  /** Injectable candidate ingestion; defaults to the real `upsertCandidate`. */
  injectImpl?: InjectCandidateFn;
  /** Agent private key; defaults to the loaded agent identity's key. */
  privateKey?: Uint8Array;
  /** Max pending rows claimed per pass. */
  batchSize?: number;
  /** Origin recorded as the submission locator. */
  origin?: string;
}

export interface ValidateSubmissionsResult {
  processed: number;
  valid: number;
  invalid: number;
  errors: number;
}

function communityIdFromBody(body: unknown): string | undefined {
  if (typeof body === "object" && body !== null) {
    const value = (body as Record<string, unknown>).community_id;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

/**
 * Claims and settles a batch of pending submission validations. Returns a tally;
 * safe to call repeatedly (the claim is `FOR UPDATE SKIP LOCKED`, so concurrent
 * passes never grab the same row).
 */
export async function processPendingValidations(
  deps: ValidateSubmissionsDeps,
): Promise<ValidateSubmissionsResult> {
  const joinImpl = deps.joinImpl ?? defaultJoinCommunity;
  const injectImpl = deps.injectImpl ?? defaultUpsertCandidate;
  const privateKey = deps.privateKey ?? loadAgentIdentity().privateKey;
  const origin = deps.origin ?? process.env.PUBLIC_APP_ORIGIN ?? "https://buzzrouter.com";

  const rows = await claimPendingValidations(deps.pool, deps.batchSize ?? 5);
  const result: ValidateSubmissionsResult = {
    errors: 0,
    invalid: 0,
    processed: 0,
    valid: 0,
  };

  for (const row of rows) {
    result.processed += 1;
    try {
      const outcome = await joinImpl({
        acceptTerms: true,
        code: row.inviteCode,
        host: row.relayHost,
        privateKey,
      });

      if (outcome.ok || isAlreadyMember(outcome)) {
        // A working invite: ingest the community carrying the code, and record
        // that the agent is now inside so summaries pick it up.
        const candidate = await injectImpl(
          deps.pool,
          normalizeRelayUrl(row.relayUrl),
          {
            evidenceId: row.relayHost,
            listing: { inviteCode: row.inviteCode },
            locator: `${origin}/submit`,
            type: "submission",
          },
        );
        await upsertMembership(deps.pool, {
          communityId: outcome.ok ? communityIdFromBody(outcome.body) : undefined,
          relayHost: row.relayHost,
          relayUrl: row.relayUrl,
        });
        await resolveSubmissionValidation(deps.pool, row.id, {
          candidateId: candidate.id,
          status: "valid",
        });
        result.valid += 1;
        console.log(`submissions.validate: valid ${row.relayHost}`);
        continue;
      }

      await resolveSubmissionValidation(deps.pool, row.id, {
        message: outcome.reason,
        status: "invalid",
      });
      result.invalid += 1;
      console.warn(`submissions.validate: invalid ${row.relayHost}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await resolveSubmissionValidation(deps.pool, row.id, {
        message: reason,
        status: "error",
      }).catch(() => undefined);
      result.errors += 1;
      console.error(`submissions.validate: error ${row.relayHost}: ${reason}`);
    }
  }

  return result;
}

/**
 * Runs `processPendingValidations` on a short interval so a submitted invite is
 * settled within a second or two of the web request enqueuing it. A non-reentrant
 * guard keeps a slow join batch from stacking. Returns a stop function that
 * clears the interval (called on worker shutdown).
 */
export function registerValidateSubmissionsPoller(
  pool: Pool,
  intervalMs = 800,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void processPendingValidations({ pool })
      .catch((error) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`submissions.validate poller: ${reason}`);
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return () => clearInterval(timer);
}
