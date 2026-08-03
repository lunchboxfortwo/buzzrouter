import { getDatabasePool } from "../../../../src/db/pool";
import { ApiError } from "../../../../src/http/api-error";
import {
  readInstallerRequest,
  requireText,
  sharedChannelErrorResponse,
} from "../../../../src/shared-channels/http";
import {
  OWNER_SESSION_HEADER,
  resolveOwnerSession,
} from "../../../../src/shared-channels/owner-session";
import {
  getOpenHubMembership,
  joinOpenHub,
  updateOpenHubSettings,
  type HubFilterMode,
} from "../../../../src/shared-channels/store";

export const runtime = "nodejs";

async function sessionFor(request: Request) {
  const pool = getDatabasePool();
  const session = await resolveOwnerSession(
    pool,
    request.headers.get(OWNER_SESSION_HEADER) ?? "",
  );
  return { pool, session };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { pool, session } = await sessionFor(request);
    return Response.json(
      await getOpenHubMembership(pool, session.communityId, session.ownerPubkey),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { pool, session } = await sessionFor(request);
    const body = await readInstallerRequest(request);
    const membership = await joinOpenHub(pool, {
      communityId: session.communityId,
      localChannelId: requireText(body.localChannelId, 200, "Local channel"),
      localChannelName: requireText(
        body.localChannelName,
        80,
        "Local channel name",
      ),
      ownerPubkey: session.ownerPubkey,
    });
    return Response.json(membership, {
      headers: { "cache-control": "no-store" },
      status: 201,
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const { pool, session } = await sessionFor(request);
    const body = await readInstallerRequest(request, 8_192);
    if (typeof body.sends !== "boolean" || typeof body.receives !== "boolean") {
      throw new ApiError("invalid_input", "Send and receive settings are invalid.");
    }
    if (
      body.filterMode !== "everyone_except" &&
      body.filterMode !== "only_these"
    ) {
      throw new ApiError("invalid_input", "Filter mode is invalid.");
    }
    if (
      !Array.isArray(body.filterList) ||
      !body.filterList.every((value) => typeof value === "string")
    ) {
      throw new ApiError("invalid_input", "Filter list is invalid.");
    }
    const membership = await updateOpenHubSettings(pool, {
      communityId: session.communityId,
      filterList: body.filterList as string[],
      filterMode: body.filterMode as HubFilterMode,
      localChannelId:
        body.localChannelId === undefined
          ? undefined
          : requireText(body.localChannelId, 200, "Local channel"),
      localChannelName:
        body.localChannelName === undefined
          ? undefined
          : requireText(body.localChannelName, 80, "Local channel name"),
      ownerPubkey: session.ownerPubkey,
      receives: body.receives,
      sends: body.sends,
    });
    return Response.json(membership, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    return sharedChannelErrorResponse(error);
  }
}
