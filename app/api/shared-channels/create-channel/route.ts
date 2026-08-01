import { getDatabasePool } from "../../../../src/db/pool";
import { authenticateJsonRequest } from "../../../../src/http/nostr-auth";
import {
  requireObject,
  requireText,
  requireUuid,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { createDedicatedChannel } from "../../../../src/shared-channels/channel-handoff";

export const runtime = "nodejs";

// Create a fresh channel for a shared-channel link so owners never have to spend
// a hand-made channel per partner. The bridge creates it (kind 9007), hands
// ownership to the signing owner, and steps itself down to a member — the whole
// sequence is resumable, so a retry with the same idempotency key finishes any
// steps a prior attempt could not.
export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const authenticated = await authenticateJsonRequest(request, pool);
    const body = requireObject(authenticated.value);
    const channel = await createDedicatedChannel(pool, {
      communityId: requireUuid(body.communityId),
      idempotencyKey: requireText(
        body.idempotencyKey,
        200,
        "Idempotency key",
      ),
      ownerPubkey: authenticated.pubkey,
      peerName: requireText(body.peerName, 80, "Peer community name"),
    });
    return Response.json(channel, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
