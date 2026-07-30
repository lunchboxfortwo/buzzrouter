import { timingSafeEqual } from "node:crypto";

const INTERNAL_USER = "buzzrouter";

export function isInternalReviewAuthorized(
  headers: Headers,
  expectedPassword = process.env.INTERNAL_REVIEW_PASSWORD,
): boolean {
  if (!expectedPassword) {
    return false;
  }

  const authorization = headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) {
    return false;
  }

  let decoded: string;
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8",
    );
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) {
    return false;
  }

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  return (
    safeEqual(username, INTERNAL_USER) &&
    safeEqual(password, expectedPassword)
  );
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}
