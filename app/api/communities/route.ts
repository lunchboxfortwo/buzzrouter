import { listDirectoryCommunities } from "../../../src/db/directory";
import { getDatabasePool } from "../../../src/db/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

export async function GET(request: Request): Promise<Response> {
  const searchParams = new URL(request.url).searchParams;
  // `?joinable=true`      — a join will actually LAND with just the code (a bare
  //                         claim / deep link succeeds): the honest one-tap feed.
  // `?joinable=handshake` — additionally includes communities behind a Buzz
  //                         ToS/age gate, which a client that completes the full
  //                         policy handshake (e.g. the BuzzRouter agent's
  //                         auto-join) can still join. NOT one-tap; excluded from
  //                         `=true` so a bare deep link is never advertised for it.
  const joinable = searchParams.get("joinable");
  const joinableOnly = joinable === "true";
  const handshakeJoinable = joinable === "handshake";
  const limit = clampLimit(searchParams.get("limit"));

  const allCommunities = await listDirectoryCommunities(getDatabasePool(), {
    limit,
  });

  const communities = allCommunities
    // "joinable" must mean a join will actually land, not just "we hold a code".
    // A public web-join URL always works; an invite code only counts once a
    // probe confirms it. `=true` demands a bare claim succeeds (`open`); the
    // `handshake` feed also allows `policy_gated` (joinable after the ToS/age
    // handshake) and as-yet-unconfirmed codes, but never a code we KNOW is
    // owner-only/allowlist (`restricted`) or dead (`stale`). Everything else is
    // still listed — just not advertised as joinable.
    .filter((community) => {
      if (!joinableOnly && !handshakeJoinable) return true;
      if (community.publicUrl) return true;
      if (joinableOnly) return community.joinStatus === "open";
      return (
        Boolean(community.inviteCode) &&
        community.joinStatus !== "restricted" &&
        community.joinStatus !== "stale"
      );
    })
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
