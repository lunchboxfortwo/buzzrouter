import { getDatabasePool } from "../../../../src/db/pool";
import { authenticateRequest } from "../../../../src/http/nostr-auth";
import {
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { listCommunityLocalChannels } from "../../../../src/shared-channels/local-channels";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const identity = await authenticateRequest(request, pool);
    const communityId = requireUuid(
      new URL(request.url).searchParams.get("communityId"),
    );
    const listing = await listCommunityLocalChannels(pool, {
      communityId,
      ownerPubkey: identity.pubkey,
    });
    return Response.json(listing, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
