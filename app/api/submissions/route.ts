import { upsertCandidate } from "../../../src/db/candidates";
import { getDatabasePool } from "../../../src/db/pool";
import {
  parseRelaySubmission,
  SubmissionValidationError,
} from "../../../src/submissions/validation";

export const runtime = "nodejs";

function extractInviteCode(value: FormDataEntryValue | null): string | null {
  if (typeof value !== "string") return null;
  const match = /\/invite\/([^/?#\s]+)/u.exec(value);
  return match ? decodeURIComponent(match[1]).slice(0, 200) : null;
}

const MAX_BODY_BYTES = 4 * 1_024;

export async function POST(request: Request): Promise<Response> {
  const requestOrigin = new URL(request.url).origin;
  const publicOrigin = process.env.PUBLIC_APP_ORIGIN ?? requestOrigin;
  if (request.headers.get("origin") !== publicOrigin) {
    return redirectToSubmission(publicOrigin, "invalid");
  }

  const contentLength = request.headers.get("content-length");
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_BODY_BYTES)
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
      return redirectToSubmission(publicOrigin, "queued");
    }

    const rawUrl = form.get("relayUrl");
    const relay = parseRelaySubmission(rawUrl);
    const inviteCode = extractInviteCode(rawUrl);
    const candidate = await upsertCandidate(getDatabasePool(), relay, {
      evidenceId: relay.canonicalRelayUrl,
      listing: inviteCode ? { inviteCode } : undefined,
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
  status: "failed" | "invalid" | "queued",
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
