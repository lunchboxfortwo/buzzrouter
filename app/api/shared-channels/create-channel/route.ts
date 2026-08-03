import { getDatabasePool } from "../../../../src/db/pool";
import {
  readInstallerRequest,
  requireText,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { createDedicatedChannel } from "../../../../src/shared-channels/channel-handoff";
import {
  OWNER_SESSION_HEADER,
  resolveOwnerSession,
} from "../../../../src/shared-channels/owner-session";

export const runtime = "nodejs";

// Channel creation is deliberately separate from filtering the combobox. The
// explicit request runs the resumable create -> promote owner -> demote bridge
// handoff and returns only after the bridge no longer owns the channel.
export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const session = await resolveOwnerSession(
      pool,
      request.headers.get(OWNER_SESSION_HEADER) ?? "",
    );
    const body = await readInstallerRequest(request);
    const channel = await createDedicatedChannel(pool, {
      channelName: requireText(body.channelName, 80, "Channel name"),
      communityId: session.communityId,
      idempotencyKey: requireText(
        body.idempotencyKey,
        200,
        "Idempotency key",
      ),
      ownerPubkey: session.ownerPubkey,
    });
    return Response.json(channel, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
