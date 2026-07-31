import { getDatabasePool } from "../../../../src/db/pool";
import {
  readInstallerRequest,
  requireInstallToken,
  requireText,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { redeemInviteAndActivate } from "../../../../src/shared-channels/installer";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readInstallerRequest(request);
    const token = requireInstallToken(body.token);
    const invite = requireText(body.invite, 900, "Invite link");
    const connection = await redeemInviteAndActivate(
      getDatabasePool(),
      token,
      invite,
    );
    return Response.json(
      {
        bridgePubkey: connection.bridgePubkey,
        relayUrl: connection.relayUrl,
        state: connection.state,
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
