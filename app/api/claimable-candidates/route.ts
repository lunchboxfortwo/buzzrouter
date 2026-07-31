import { searchClaimableCandidates } from "../../../src/claims/store";
import { getDatabasePool } from "../../../src/db/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).searchParams.get("q") ?? "";
  const candidates = await searchClaimableCandidates(
    getDatabasePool(),
    search,
  );

  return Response.json(
    { candidates },
    { headers: { "cache-control": "no-store" } },
  );
}
