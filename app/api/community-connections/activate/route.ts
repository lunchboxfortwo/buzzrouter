import { getDatabasePool } from "../../../../src/db/pool";
import {
  readInstallerRequest,
  requireInstallToken,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { verifyAndActivateCommunityConnection } from "../../../../src/shared-channels/installer";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readInstallerRequest(request);
    const token = requireInstallToken(body.token);
    const connection = await verifyAndActivateCommunityConnection(
      getDatabasePool(),
      token,
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
