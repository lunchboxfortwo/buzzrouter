import { getDatabasePool } from "../../../../src/db/pool";
import {
  readInstallerRequest,
  requireInstallToken,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import { getCommunityInstallDescriptor } from "../../../../src/shared-channels/installer";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readInstallerRequest(request);
    const token = requireInstallToken(body.token);
    const descriptor = await getCommunityInstallDescriptor(
      getDatabasePool(),
      token,
    );
    return Response.json(descriptor, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
