import { getDatabasePool } from "../../../src/db/pool";
import {
  authenticateJsonRequest,
  authenticateRequest,
} from "../../../src/http/nostr-auth";
import { ApiError } from "../../../src/http/api-error";
import {
  readInstallerRequest,
  requireObject,
  requireText,
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../src/shared-channels/http";
import {
  OWNER_SESSION_HEADER,
  resolveOwnerSession,
} from "../../../src/shared-channels/owner-session";
import {
  createSharedChannel,
  getSharedChannelAdminWorkspace,
} from "../../../src/shared-channels/store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const token = request.headers.get(OWNER_SESSION_HEADER);
    const session = token ? await resolveOwnerSession(pool, token) : null;
    const ownerPubkey = session
      ? session.ownerPubkey
      : (await authenticateRequest(request, pool)).pubkey;
    const fullWorkspace = await getSharedChannelAdminWorkspace(
      pool,
      ownerPubkey,
    );
    const workspace = session
      ? {
          channels: fullWorkspace.channels.filter(
            (channel) => channel.ownCommunityId === session.communityId,
          ),
          communities: fullWorkspace.communities.filter(
            (community) => community.id === session.communityId,
          ),
          destinations: fullWorkspace.destinations,
        }
      : fullWorkspace;
    return Response.json(workspace, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}

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
    const sourceCommunityId = requireUuid(body.sourceCommunityId);
    if (session && sourceCommunityId !== session.communityId) {
      throw new ApiError(
        "owner_session_forbidden",
        "The owner session does not match this community.",
        403,
      );
    }
    const channel = await createSharedChannel(pool, {
      destinationCommunityId: requireUuid(body.destinationCommunityId),
      idempotencyKey: requireText(
        body.idempotencyKey,
        200,
        "Idempotency key",
      ),
      ownerPubkey: session?.ownerPubkey ?? authenticated!.pubkey,
      proposedName: requireText(body.proposedName, 80, "Channel name"),
      purpose: requireText(body.purpose, 500, "Purpose"),
      sourceChannelId: requireText(
        body.sourceChannelId,
        200,
        "Source channel",
      ),
      sourceChannelName: requireText(
        body.sourceChannelName,
        80,
        "Source channel name",
      ),
      sourceCommunityId,
    });
    return Response.json(channel, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
