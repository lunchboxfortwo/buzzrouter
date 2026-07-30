import { getDatabasePool } from "../../../../../../src/db/pool";
import {
  authenticateJsonRequest,
  claimErrorResponse,
  requireObject,
  requireUuid,
} from "../../../../../../src/claims/http";
import { verifyClaimProof } from "../../../../../../src/claims/proof";
import {
  beginChallengeAttempt,
  completeClaimChallenge,
  failChallengeAttempt,
} from "../../../../../../src/claims/store";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const authenticated = await authenticateJsonRequest(request, pool);
    requireObject(authenticated.value);
    const challengeId = requireUuid((await context.params).id);
    const challenge = await beginChallengeAttempt(
      pool,
      challengeId,
      authenticated.pubkey,
    );

    try {
      await verifyClaimProof(challenge);
    } catch (error) {
      await failChallengeAttempt(pool, challengeId, challenge.attempts);
      throw error;
    }

    const status = await completeClaimChallenge(pool, challenge);
    return Response.json(
      { candidateId: challenge.candidateId, status },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return claimErrorResponse(error);
  }
}
