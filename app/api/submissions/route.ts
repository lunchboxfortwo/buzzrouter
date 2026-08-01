import { upsertCandidate } from "../../../src/db/candidates";
import { getDatabasePool } from "../../../src/db/pool";
import {
  createSubmissionValidation,
  getSubmissionValidation,
} from "../../../src/db/submission-validations";
import { checkSubmissionRateLimit } from "../../../src/http/rate-limit";
import {
  parseCategories,
  parseContactEmail,
  parseFocus,
  parseListingText,
  parseRelaySubmission,
  SubmissionValidationError,
} from "../../../src/submissions/validation";

export const runtime = "nodejs";

/** How long the request waits for the worker to settle an invite validation. */
const VALIDATION_WAIT_MS = 8_000;
const VALIDATION_POLL_MS = 500;
const MAX_BODY_BYTES = 4 * 1_024;

type SubmissionStatus =
  | "failed"
  | "invalid"
  | "invite_invalid"
  | "queued"
  | "rate_limited"
  | "verified"
  | "verifying";

function extractInviteCode(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const match = /\/invite\/([^/?#\s]+)/u.exec(value);
  return match ? decodeURIComponent(match[1]).slice(0, 200) : null;
}

/** Best-effort client IP behind the Cloudflare tunnel. */
function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls the worker's verdict for a submitted invite. Returns "verified" when the
 * agent joined, "invite_invalid" when the claim was rejected, or "verifying" if
 * the worker has not settled it within the wait budget (it still finishes in the
 * background — the listing just appears a moment later).
 */
async function waitForValidation(
  id: string,
): Promise<"verified" | "invite_invalid" | "verifying"> {
  const deadline = Date.now() + VALIDATION_WAIT_MS;
  const pool = getDatabasePool();
  while (Date.now() < deadline) {
    const row = await getSubmissionValidation(pool, id);
    if (row) {
      if (row.status === "valid") return "verified";
      if (row.status === "invalid" || row.status === "error") {
        return "invite_invalid";
      }
    }
    await sleep(VALIDATION_POLL_MS);
  }
  return "verifying";
}

export async function POST(request: Request): Promise<Response> {
  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? requestOrigin;
  if (request.headers.get("origin") !== publicOrigin) {
    return redirectToSubmission(publicOrigin, "invalid");
  }

  // Rate limit before any work, so the generic submit page can't be used as an
  // unthrottled side door around this same endpoint.
  if (!checkSubmissionRateLimit(clientIp(request)).allowed) {
    return redirectToSubmission(publicOrigin, "rate_limited");
  }

  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)
  ) {
    return redirectToSubmission(publicOrigin, "invalid");
  }
  if (
    request.headers.get("content-type")?.split(";", 1)[0] !==
    "application/x-www-form-urlencoded"
  ) {
    return redirectToSubmission(publicOrigin, "invalid");
  }

  try {
    const form = new URLSearchParams(await readBoundedBody(request));
    if (String(form.get("website") ?? "").trim()) {
      // Honeypot filled — a bot. Silently pretend success.
      return redirectToSubmission(publicOrigin, "queued");
    }

    const rawUrl = form.get("relayUrl");
    const relay = parseRelaySubmission(rawUrl);
    const inviteCode = extractInviteCode(rawUrl);

    // Per-community CTA passes the community it is scoped to; reject an invite
    // pasted for a different community than the profile it came from.
    const expectHost = String(form.get("expectHost") ?? "").trim().toLowerCase();
    if (expectHost && relay.host.toLowerCase() !== expectHost) {
      return redirectToSubmission(publicOrigin, "invalid");
    }

    if (inviteCode) {
      // Invite present → validate synchronously: the worker joins with it (which
      // both verifies the code and admits the agent) and we wait for the verdict.
      // This is the fast "add an invite" path (per-community CTA, or a bare
      // invite link pasted into the full intake form below) — it doesn't collect
      // the rich intake fields, matching how it already behaves in production.
      const id = await createSubmissionValidation(getDatabasePool(), {
        inviteCode,
        relayHost: relay.host,
        relayUrl: relay.canonicalRelayUrl,
      });
      const outcome = await waitForValidation(id);
      return redirectToSubmission(publicOrigin, outcome, relay.host);
    }

    // Bare relay URL, no invite → the full intake form: collect what other
    // people need to care about this community, then ingest for the async
    // probe pipeline as before.
    const contactEmail = parseContactEmail(form.get("contactEmail"));
    const displayName = parseListingText(form.get("communityName"), 80);
    const description = parseListingText(form.get("description"), 500);
    const audience = parseListingText(form.get("audience"), 300);
    const focus = parseFocus(form.get("focus"));
    const categories = parseCategories(form.getAll("categories"));

    const candidate = await upsertCandidate(getDatabasePool(), relay, {
      evidenceId: relay.canonicalRelayUrl,
      listing: {
        audience,
        categories,
        contactEmail,
        description,
        displayName,
        focus,
        inviteCode,
      },
      locator: `${publicOrigin}/submit`,
      type: "submission",
    });
    return redirectToSubmission(publicOrigin, "queued", relay.host, candidate.id);
  } catch (error) {
    if (
      error instanceof SubmissionValidationError ||
      error instanceof TypeError
    ) {
      return redirectToSubmission(publicOrigin, "invalid");
    }
    return redirectToSubmission(publicOrigin, "failed");
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  if (!request.body) {
    throw new SubmissionValidationError("Submission body is required.");
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new SubmissionValidationError("Submission body is too large.");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(body);
}

function redirectToSubmission(
  origin: string,
  status: SubmissionStatus,
  host?: string,
  candidateId?: string,
): Response {
  const url = new URL("/submit", origin);
  url.searchParams.set("status", status);
  if (host) {
    url.searchParams.set("host", host);
  }
  if (candidateId) {
    url.searchParams.set("candidate", candidateId);
  }
  return Response.redirect(url, 303);
}
