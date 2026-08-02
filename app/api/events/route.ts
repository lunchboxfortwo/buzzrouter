import { recordFunnelEvent, type FunnelEventType } from "../../../src/db/funnel";
import { getDatabasePool } from "../../../src/db/pool";
import { checkEventRateLimit } from "../../../src/http/rate-limit";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 1_024;
const EVENT_TYPES = new Set<FunnelEventType>(["join_click"]);
const AFFORDANCES = new Set(["invite_join", "row_join", "open_community"]);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Best-effort client IP behind the Cloudflare tunnel. */
function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

function deviceFromUserAgent(ua: string | null): string {
  if (!ua) return "unknown";
  return /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? "mobile" : "desktop";
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * Layer-1 funnel beacon sink. Same-origin only, rate-limited, tiny body. Records
 * an anonymous join-affordance click; the device is derived server-side from the
 * user agent, never trusted from the client. Always answers a beacon with an
 * empty body — 204 on success, an error status the beacon ignores otherwise.
 */
export async function POST(request: Request): Promise<Response> {
  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? requestOrigin;
  if (request.headers.get("origin") !== publicOrigin) {
    return new Response(null, { status: 403 });
  }

  if (!checkEventRateLimit(clientIp(request))) {
    return new Response(null, { status: 429 });
  }

  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return new Response(null, { status: 413 });
  }

  let payload: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
    payload = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (typeof payload !== "object" || payload === null) {
    return new Response(null, { status: 400 });
  }
  const body = payload as Record<string, unknown>;

  const eventType = boundedString(body.event_type, 40);
  if (!eventType || !EVENT_TYPES.has(eventType as FunnelEventType)) {
    return new Response(null, { status: 400 });
  }

  const affordanceRaw = boundedString(body.affordance, 40);
  const affordance =
    affordanceRaw && AFFORDANCES.has(affordanceRaw) ? affordanceRaw : null;
  const host = boundedString(body.host, 253);
  const candidateRaw = boundedString(body.candidateId, 64);
  const candidateId =
    candidateRaw && UUID.test(candidateRaw) ? candidateRaw : null;
  const sessionId = boundedString(body.session_id, 64);

  try {
    await recordFunnelEvent(getDatabasePool(), {
      affordance,
      candidateId,
      device: deviceFromUserAgent(request.headers.get("user-agent")),
      eventType: eventType as FunnelEventType,
      host,
      sessionId,
    });
  } catch {
    // Best-effort sink: never surface a storage error to a fire-and-forget beacon.
  }
  return new Response(null, { status: 204 });
}
