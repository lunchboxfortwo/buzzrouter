import { getDatabasePool } from "../../../../src/db/pool";
import {
  readInstallerRequest,
  requireText,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import {
  OWNER_SESSION_HEADER,
  resolveOwnerSession,
} from "../../../../src/shared-channels/owner-session";
import { connectFeaturedCommunity } from "../../../../src/shared-channels/store";

export const runtime = "nodejs";

// The one-press "Connect with the BuzzRouter community" CTA. Authorized by the
// community-scoped owner session from the signer-free invite flow — never a
// browser signature. The actual bind still requires the roster-signed code the
// owner types into the chosen channel; this only arms it.
export async function POST(request: Request): Promise<Response> {
  try {
    const pool = getDatabasePool();
    const session = await resolveOwnerSession(
      pool,
      request.headers.get(OWNER_SESSION_HEADER) ?? "",
    );
    const body = await readInstallerRequest(request);
    const result = await connectFeaturedCommunity(pool, {
      communityId: session.communityId,
      idempotencyKey: requireText(
        body.idempotencyKey,
        200,
        "Idempotency key",
      ),
      localChannelId: requireText(body.localChannelId, 200, "Local channel"),
      localChannelName: requireText(
        body.localChannelName,
        80,
        "Local channel name",
      ),
      ownerPubkey: session.ownerPubkey,
    });
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
