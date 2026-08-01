import { getSubmissionPrefill } from "../../../../src/db/directory";
import { getDatabasePool } from "../../../../src/db/pool";
import { normalizeRelayUrl } from "../../../../src/discovery/normalize";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const relayUrl = new URL(request.url).searchParams.get("relayUrl") ?? "";

  let canonicalRelayUrl: string;
  try {
    canonicalRelayUrl = normalizeRelayUrl(relayUrl.trim()).canonicalRelayUrl;
  } catch {
    return Response.json({ prefill: null });
  }

  const prefill = await getSubmissionPrefill(
    getDatabasePool(),
    canonicalRelayUrl,
  );
  return Response.json({ prefill });
}
