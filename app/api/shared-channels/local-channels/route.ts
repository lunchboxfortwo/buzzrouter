import { getDatabasePool } from "../../../../src/db/pool";
import { authenticateRequest } from "../../../../src/http/nostr-auth";
import { ApiError } from "../../../../src/http/api-error";
import {
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { listCommunityLocalChannels } from "../../../../src/shared-channels/local-channels";
import {
  OWNER_SESSION_HEADER,
  resolveOwnerSession,
} from "../../../../src/shared-channels/owner-session";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const token = request.headers.get(OWNER_SESSION_HEADER);
    const session = token ? await resolveOwnerSession(pool, token) : null;
    const ownerPubkey = session
      ? session.ownerPubkey
      : (await authenticateRequest(request, pool)).pubkey;
    const communityId = requireUuid(
      new URL(request.url).searchParams.get("communityId"),
    );
    if (session && communityId !== session.communityId) {
      throw new ApiError(
        "owner_session_forbidden",
        "The owner session does not match this community.",
        403,
      );
    }
    const listing = await listCommunityLocalChannels(pool, {
      communityId,
      ownerPubkey,
    });
    return Response.json(listing, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
