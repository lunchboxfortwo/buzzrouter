import { getDatabasePool } from "../../../src/db/pool";
import { searchVerifiedCommunities } from "../../../src/shared-channels/community-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams.get("q") ?? "";
  const communities = await searchVerifiedCommunities(
    getDatabasePool(),
    search,
  );

  return Response.json(
    { communities },
    { headers: { "cache-control": "no-store" } },
  );
}
