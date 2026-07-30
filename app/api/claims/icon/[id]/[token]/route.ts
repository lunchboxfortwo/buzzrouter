import { getDatabasePool } from "../../../../../../src/db/pool";
import { requireUuid } from "../../../../../../src/claims/http";
import { validateIconToken } from "../../../../../../src/claims/proof";
import { isChallengeTokenValid } from "../../../../../../src/claims/store";

export const runtime = "nodejs";

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; token: string }> },
): Promise<Response> {
  try {
    const params = await context.params;
    const challengeId = requireUuid(params.id);
    const pool = getDatabasePool();
    const valid = await validateIconToken(
      pool,
      challengeId,
      params.token,
      isChallengeTokenValid,
    );
    if (!valid) {
      return new Response(null, {
        headers: { "cache-control": "no-store" },
        status: 404,
      });
    }

    return new Response(TRANSPARENT_PNG, {
      headers: {
        "cache-control": "no-store",
        "content-type": "image/png",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response(null, {
      headers: { "cache-control": "no-store" },
      status: 404,
    });
  }
}
