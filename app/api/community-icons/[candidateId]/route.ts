import { getDatabasePool } from "../../../../src/db/pool";
import { requireUuid } from "../../../../src/http/validation";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ candidateId: string }> },
): Promise<Response> {
  let candidateId: string;
  try {
    candidateId = requireUuid((await context.params).candidateId);
  } catch {
    return new Response(null, {
      headers: { "cache-control": "no-store" },
      status: 404,
    });
  }

  const result = await getDatabasePool().query<{
    content_hash: string;
    content_type: string;
    image_bytes: Buffer;
  }>(
    `
      SELECT content_hash, content_type, image_bytes
      FROM community_icons
      WHERE candidate_id = $1
    `,
    [candidateId],
  );
  const icon = result.rows[0];
  if (!icon) {
    return new Response(null, {
      headers: { "cache-control": "no-store" },
      status: 404,
    });
  }

  const etag = `"${icon.content_hash}"`;
  const headers = {
    "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    "content-type": icon.content_type,
    etag,
    "x-content-type-options": "nosniff",
  };
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { headers, status: 304 });
  }

  return new Response(new Uint8Array(icon.image_bytes), { headers });
}
