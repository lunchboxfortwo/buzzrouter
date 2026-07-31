import { getDatabasePool } from "../../../../src/db/pool";
import { authenticateJsonRequest } from "../../../../src/http/nostr-auth";
import {
  requireObject,
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { createCommunityInstallToken } from "../../../../src/shared-channels/installer";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const authenticated = await authenticateJsonRequest(request, pool);
    const body = requireObject(authenticated.value);
    const result = await createCommunityInstallToken(pool, {
      communityId: requireUuid(body.communityId),
      ownerPubkey: authenticated.pubkey,
    });
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
