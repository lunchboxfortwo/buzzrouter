import { getDatabasePool } from "../../../src/db/pool";
import { ApiError } from "../../../src/http/api-error";
import { checkSubmissionRateLimit } from "../../../src/http/rate-limit";
import { assertCommunityName } from "../../../src/hosted-signup/builderlab-client";
import { HOSTED_CREATE_NOTE } from "../../../src/hosted-signup/copy";
import { createLiveProvisionDeps } from "../../../src/hosted-signup/provision-live";
import { provisionHostedCommunity } from "../../../src/hosted-signup/provision";
import { parseContactEmail } from "../../../src/submissions/validation";

export const runtime = "nodejs";

const MAX_BODY_BYTES = 4 * 1_024;

/** Where to point people when automated provisioning is off or fails. */
const SELF_SERVE_FALLBACK = "https://app.builderlab.xyz";

/** Best-effort client IP behind the Cloudflare tunnel. */
function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

export async function POST(request: Request): Promise<Response> {
  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? requestOrigin;
  if (request.headers.get("origin") !== publicOrigin) {
    return errorResponse("invalid_origin", "Invalid request origin.", 403);
  }

  if (!checkSubmissionRateLimit(clientIp(request)).allowed) {
    return errorResponse(
      "rate_limited",
      "Too many attempts. Please wait a moment and try again.",
      429,
    );
  }

  if (
    (request.headers.get("content-type")?.split(";", 1)[0] ?? "") !==
    "application/json"
  ) {
    return errorResponse("invalid_body", "Expected a JSON body.", 415);
  }
  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return errorResponse("invalid_body", "Request body is too large.", 413);
  }

  let name: string;
  let contactEmail: string;
  try {
    const raw = (await request.json()) as unknown;
    if (typeof raw !== "object" || raw === null) {
      throw new ApiError("invalid_body", "Expected a JSON object.");
    }
    const body = raw as Record<string, unknown>;
    name = typeof body.name === "string" ? body.name.trim().toLowerCase() : "";
    assertCommunityName(name);
    contactEmail = parseContactEmail(body.email);
  } catch (error) {
    if (error instanceof ApiError) {
      return errorResponse(error.code, error.message, error.status);
    }
    return errorResponse(
      "invalid_community_name",
      "Community name must be lowercase letters, digits, and single dashes, " +
        "and a valid email is required.",
      400,
    );
  }

  try {
    const deps = createLiveProvisionDeps(getDatabasePool(), { publicOrigin });
    const result = await provisionHostedCommunity({ contactEmail, name }, deps);
    // The nsec is returned ONCE here and never logged or persisted in plaintext.
    return Response.json(
      {
        communityUrl: result.communityUrl,
        host: result.host,
        npub: result.npub,
        nsec: result.nsec,
        resumed: result.resumed,
        note: HOSTED_CREATE_NOTE,
      },
      { headers: { "cache-control": "no-store" }, status: 201 },
    );
  } catch (error) {
    const apiError =
      error instanceof ApiError
        ? error
        : new ApiError("provision_failed", "Provisioning failed.", 502);
    return errorResponse(apiError.code, friendlyMessage(apiError), apiError.status);
  }
}

/** Map internal codes to a user-facing sentence. Never leaks a secret. */
function friendlyMessage(error: ApiError): string {
  switch (error.code) {
    case "hosted_signup_live_disabled":
      return "Automated community creation is turned off here right now.";
    case "community_name_taken":
      return "That community name is already taken. Try another.";
    case "signup_automation_failed":
    case "signup_browser_unavailable":
    case "signup_no_login_code":
      return "We couldn't complete the automated signup at the hosted Buzz service.";
    case "provision_unresumable":
      return error.message;
    default:
      return "We couldn't create your community automatically.";
  }
}

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    { error: code, fallbackUrl: SELF_SERVE_FALLBACK, message },
    { headers: { "cache-control": "no-store" }, status },
  );
}
