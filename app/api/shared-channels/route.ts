import { getDatabasePool } from "../../../src/db/pool";
import {
  authenticateJsonRequest,
  authenticateRequest,
} from "../../../src/http/nostr-auth";
import {
  requireObject,
  requireText,
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../src/shared-channels/http";
import {
  createSharedChannel,
  getSharedChannelAdminWorkspace,
} from "../../../src/shared-channels/store";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const identity = await authenticateRequest(request, pool);
    const workspace = await getSharedChannelAdminWorkspace(
      pool,
      identity.pubkey,
    );
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
    const authenticated = await authenticateJsonRequest(request, pool);
    const body = requireObject(authenticated.value);
    const channel = await createSharedChannel(pool, {
      destinationCommunityId: requireUuid(body.destinationCommunityId),
      idempotencyKey: requireText(
        body.idempotencyKey,
        200,
        "Idempotency key",
      ),
      ownerPubkey: authenticated.pubkey,
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
      sourceCommunityId: requireUuid(body.sourceCommunityId),
    });
    return Response.json(channel, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
