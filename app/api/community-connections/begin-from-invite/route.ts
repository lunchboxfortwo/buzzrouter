import { getDatabasePool } from "../../../../src/db/pool";
import {
  readInstallerRequest,
  requireText,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { beginConnectionFromInvite } from "../../../../src/shared-channels/installer";

export const runtime = "nodejs";

// Signer-free entry for the mobile Connect flow: no NIP-98 signature. The pasted
// invite link identifies the community and the bridge redeems it to prove
// admission; we return a short-lived, community-scoped owner session the page
// uses in place of a browser signer.
export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readInstallerRequest(request);
    const invite = requireText(body.invite, 900, "Invite link");
    const result = await beginConnectionFromInvite(
      getDatabasePool(),
      invite,
    );
    return Response.json(result, {
      headers: { "cache-control": "no-store" },
      status: result.reentered ? 200 : 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
