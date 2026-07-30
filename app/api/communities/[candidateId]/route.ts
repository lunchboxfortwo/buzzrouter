import { getDatabasePool } from "../../../../src/db/pool";
import {
  authenticateJsonRequest,
  claimErrorResponse,
  requireUuid,
} from "../../../../src/claims/http";
import { updateListingMetadata } from "../../../../src/claims/store";
import { parseListingMetadata } from "../../../../src/claims/validation";

export const runtime = "nodejs";

export async function PUT(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const authenticated = await authenticateJsonRequest(request, pool);
    const candidateId = requireUuid((await context.params).candidateId);
    const metadata = parseListingMetadata(authenticated.value);
    const result = await updateListingMetadata(
      pool,
      candidateId,
      authenticated.pubkey,
      metadata,
    );

    return Response.json(result, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return claimErrorResponse(error);
  }
}
