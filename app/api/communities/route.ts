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
    // "joinable" means a user CAN join, not "the claim is frictionless". A
    // public web-join URL always works; an invite code is joinable unless a
    // probe found the door genuinely closed — owner-only/allowlist
    // (`restricted`). A ToS/age gate (`policy_gated`) is one consent click, not a
    // dead end (`/join/[candidateId]` mints a policy receipt), so it stays
    // joinable; `stale`/unconfirmed codes degrade gracefully into the same flow
    // rather than being hidden. Only a known-`restricted` code is withheld — the
    // row still lists, with "Request an invite" instead of a join button.
    .filter(
      (community) =>
        !joinableOnly ||
        community.publicUrl ||
        (Boolean(community.inviteCode) && community.joinStatus !== "restricted"),
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
