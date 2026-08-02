"use client";

/** Bare relay host (drops the wss:// scheme and any path), for keying events. */
export function hostFromRelayUrl(relayUrl: string): string {
  return relayUrl.replace(/^wss?:\/\//i, "").replace(/\/.*$/, "");
}

/**
 * A stable, anonymous, first-party id so repeated clicks from one visitor can be
 * de-duplicated into "unique clickers". Random UUID in a 1-year first-party
 * cookie — no PII, not cross-site. Best-effort; returns null if unavailable.
 */
function getSessionId(): string | null {
  try {
    const key = "br_sid";
    const found = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${key}=`));
    if (found) return found.slice(key.length + 1);
    const id = crypto.randomUUID();
    document.cookie = `${key}=${id}; Max-Age=31536000; Path=/; SameSite=Lax`;
    return id;
  } catch {
    return null;
  }
}

/**
 * Fire-and-forget Layer-1 funnel beacon when a visitor clicks a join affordance.
 * Records INTENT only (which community/affordance/device) plus an anonymous
 * session id for dedup — no PII, no outcome. Best-effort: prefers `sendBeacon`,
 * falls back to a keepalive fetch, and never throws into the UI or blocks the
 * click it rides along with.
 */
export function trackJoinClick(payload: {
  candidateId?: string | null;
  host: string;
  affordance: string;
}): void {
  try {
    const body = JSON.stringify({
      event_type: "join_click",
      session_id: getSessionId(),
      ...payload,
    });
    const blob = new Blob([body], { type: "application/json" });
    if (
      typeof navigator !== "undefined" &&
      navigator.sendBeacon?.("/api/events", blob)
    ) {
      return;
    }
    void fetch("/api/events", {
      body,
      headers: { "content-type": "application/json" },
      keepalive: true,
      method: "POST",
    }).catch(() => {});
  } catch {
    // Best-effort analytics: never let it affect the join action.
  }
}
