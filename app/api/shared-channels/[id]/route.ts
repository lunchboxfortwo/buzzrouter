import { getDatabasePool } from "../../../../src/db/pool";
import { authenticateRequest } from "../../../../src/http/nostr-auth";
import {
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { getSharedChannelAdminWorkspace } from "../../../../src/shared-channels/store";
import { ApiError } from "../../../../src/http/api-error";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const id = requireUuid((await context.params).id);
    const pool = getDatabasePool();
    const identity = await authenticateRequest(request, pool);
    const workspace = await getSharedChannelAdminWorkspace(
      pool,
      identity.pubkey,
    );
    const channel = workspace.channels.find((entry) => entry.id === id);
    if (!channel) {
      throw new ApiError(
        "shared_channel_not_found",
        "The shared channel is unavailable.",
        404,
      );
    }
    return Response.json(channel, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
