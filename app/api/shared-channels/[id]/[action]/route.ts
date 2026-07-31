import { getDatabasePool } from "../../../../../src/db/pool";
import { authenticateJsonRequest } from "../../../../../src/http/nostr-auth";
import { ApiError } from "../../../../../src/http/api-error";
import {
  requireObject,
  requireText,
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../../../src/shared-channels/http";
import {
  armSharedChannelConfirmation,
  disconnectSharedChannel,
  pauseSharedChannelEndpoint,
  rejectSharedChannel,
  resumeSharedChannelEndpoint,
} from "../../../../../src/shared-channels/store";

export const runtime = "nodejs";

const ACTIONS = [
  "accept",
  "reject",
  "pause",
  "resume",
  "disconnect",
] as const;

type SharedChannelAction = (typeof ACTIONS)[number];

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string; id: string }> },
): Promise<Response> {
  try {
    const params = await context.params;
    const sharedChannelId = requireUuid(params.id);
    const action = parseAction(params.action);
    const pool = getDatabasePool();
    const authenticated = await authenticateJsonRequest(request, pool);
    const body = requireObject(authenticated.value);
    const common = {
      communityId: requireUuid(body.communityId),
      idempotencyKey: requireText(
        body.idempotencyKey,
        200,
        "Idempotency key",
      ),
      ownerPubkey: authenticated.pubkey,
      sharedChannelId,
    };

    // `accept` no longer activates: it arms a chat-proof confirmation and
    // returns the one-time code the owner must type into the chosen channel.
    if (action === "accept") {
      const confirmation = await armSharedChannelConfirmation(pool, {
        ...common,
        localChannelId: requireText(
          body.localChannelId,
          200,
          "Local channel",
        ),
        localChannelName: requireText(
          body.localChannelName,
          80,
          "Local channel name",
        ),
      });
      return Response.json(confirmation, {
        headers: { "cache-control": "no-store" },
      });
    }

    const channel =
      action === "reject"
        ? await rejectSharedChannel(pool, common)
        : action === "pause"
          ? await pauseSharedChannelEndpoint(pool, common)
          : action === "resume"
            ? await resumeSharedChannelEndpoint(pool, common)
            : await disconnectSharedChannel(pool, common);

    return Response.json(channel, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}

function parseAction(value: string): SharedChannelAction {
  if (!ACTIONS.includes(value as SharedChannelAction)) {
    throw new ApiError(
      "shared_channel_action_not_found",
      "The shared-channel action is unavailable.",
      404,
    );
  }
  return value as SharedChannelAction;
}
