"use client";

export const INSTALL_URL = "https://buzz.xyz";

export interface JoinTarget {
  inviteCode: string | null;
  publicUrl: string | null;
  relayUrl: string;
}

/**
 * Builds the Buzz app handoff. The mobile app registers the `buzz://` scheme
 * and its join parser expects `buzz://join?relay=<wss>&code=<code>`, rejecting
 * the link if the code is missing. So a real join handoff is only possible for
 * communities that carry an invite code; a bare relay has no deep link.
 */
export function buildJoinUri(relayUrl: string, inviteCode: string): string {
  const relay = encodeURIComponent(relayUrl);
  const code = encodeURIComponent(inviteCode);
  return `buzz://join?relay=${relay}&code=${code}`;
}

export function hasJoinTarget(target: JoinTarget): boolean {
  return Boolean(target.inviteCode || target.publicUrl);
}

/**
 * One join cascade, shared by the inspector button and the mobile list cell.
 *
 * - Invite code present: open the app via `buzz://join`. There is no reliable
 *   way to know whether the app is installed, so we attempt the handoff and,
 *   if the tab is still foregrounded shortly after, fall back to the install
 *   page. A successful open backgrounds the tab and cancels the fallback.
 *   The join URI is copied to the clipboard first (still inside the tap
 *   gesture) so the address survives a trip through the install page.
 * - Public URL present: open the web experience in a new tab.
 * - Neither: nothing to launch; the caller keeps its own behavior.
 */
export function launchJoin(target: JoinTarget): boolean {
  if (target.inviteCode) {
    const uri = buildJoinUri(target.relayUrl, target.inviteCode);
    void navigator.clipboard?.writeText(uri).catch(() => {
      // Best effort: the deep link still fires without the clipboard.
    });

    let fallbackTimer: number | null = null;
    const onHide = () => {
      if (fallbackTimer !== null) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    };
    document.addEventListener("visibilitychange", onHide, { once: true });

    fallbackTimer = window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onHide);
      window.location.href = INSTALL_URL;
    }, 1600);

    window.location.href = uri;
    return true;
  }

  if (target.publicUrl) {
    window.open(target.publicUrl, "_blank", "noopener,noreferrer");
    return true;
  }

  return false;
}
