import { listDirectoryCommunities } from "../../../src/db/directory";
import { getDatabasePool } from "../../../src/db/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  const joinableOnly = searchParams.get("joinable") === "true";
  const limit = clampLimit(searchParams.get("limit"));

  const allCommunities = await listDirectoryCommunities(getDatabasePool(), {
    limit,
  });

  const communities = allCommunities
    .filter(
      (community) =>
        !joinableOnly || community.inviteCode || community.publicUrl,
    )
    .map((community) => ({
      host: community.relayHost,
      relayUrl: community.canonicalRelayUrl,
      displayName: community.displayName,
      description: community.description,
      focus: community.focus,
      categories: community.categories,
      joinMode: community.joinMode,
      inviteCode: community.inviteCode,
      publicUrl: community.publicUrl,
      lastVerifiedAt: community.lastVerifiedAt,
      slug: community.slug,
    }));

  return Response.json(
    { communities, count: communities.length },
    {
      headers: {
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
      },
    },
  );
}

function clampLimit(raw: string | null): number {
  const parsed = raw === null ? DEFAULT_LIMIT : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_LIMIT;
  }
  return Math.min(parsed, MAX_LIMIT);
}
