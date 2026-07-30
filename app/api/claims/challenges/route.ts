import { randomBytes } from "node:crypto";

import { getDatabasePool } from "../../../../src/db/pool";
import {
  authenticateJsonRequest,
  claimErrorResponse,
  requireObject,
  requireUuid,
} from "../../../../src/claims/http";
import {
  createClaimInstructions,
  createTokenHash,
} from "../../../../src/claims/proof";
import { createClaimChallenge } from "../../../../src/claims/store";
import { parseClaimMethod } from "../../../../src/claims/validation";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const authenticated = await authenticateJsonRequest(request, pool);
    const body = requireObject(authenticated.value);
    const candidateId = requireUuid(body.candidateId);
    const method = parseClaimMethod(body.method);
    const token = randomBytes(32).toString("base64url");
    const challenge = await createClaimChallenge(
      pool,
      candidateId,
      authenticated.pubkey,
      method,
      createTokenHash(token),
    );

    return Response.json(
      {
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
        instructions: createClaimInstructions(challenge, token),
      },
      { headers: { "cache-control": "no-store" }, status: 201 },
    );
  } catch (error) {
    return claimErrorResponse(error);
  }
}
