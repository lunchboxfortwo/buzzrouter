import { getDatabasePool } from "../../../../src/db/pool";
import { authenticateJsonRequest } from "../../../../src/http/nostr-auth";
import { ApiError } from "../../../../src/http/api-error";
import {
  readInstallerRequest,
  requireObject,
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { createCommunityInstallToken } from "../../../../src/shared-channels/installer";
import {
  OWNER_SESSION_HEADER,
  resolveOwnerSession,
} from "../../../../src/shared-channels/owner-session";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const token = request.headers.get(OWNER_SESSION_HEADER);
    const session = token ? await resolveOwnerSession(pool, token) : null;
    const authenticated = session
      ? null
      : await authenticateJsonRequest(request, pool);
    const body = session
      ? await readInstallerRequest(request)
      : requireObject(authenticated!.value);
    const communityId = requireUuid(body.communityId);
    if (session && communityId !== session.communityId) {
      throw new ApiError(
        "owner_session_forbidden",
        "The owner session does not match this community.",
        403,
      );
    }
    const result = await createCommunityInstallToken(pool, {
      communityId,
      ownerPubkey: session?.ownerPubkey ?? authenticated!.pubkey,
    });
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
