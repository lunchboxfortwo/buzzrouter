"use client";

import { useCallback, useRef, useState } from "react";

const INSTALL_URL = "https://buzz.xyz";

/**
 * Builds the Buzz app handoff. The mobile app registers the `buzz://` scheme
 * and its join parser expects `buzz://join?relay=<wss>&code=<code>`, rejecting
 * the link if the code is missing. So a real join handoff is only possible for
 * communities that carry an invite code; a bare relay has no deep link.
 */
function buildJoinUri(relayUrl: string, inviteCode: string): string {
  const relay = encodeURIComponent(relayUrl);
  const code = encodeURIComponent(inviteCode);
  return `buzz://join?relay=${relay}&code=${code}`;
}

/**
 * One join action per community.
 *
 * - Invite code present: open the app via `buzz://join`. There is no reliable
 *   way to know whether the app is installed, so we attempt the handoff and,
 *   if the tab is still foregrounded shortly after, fall back to the install
 *   page. A successful open backgrounds the tab and cancels the fallback.
 * - Public URL present: a plain link, which opens the web experience.
 * - Neither: copy the relay URL, which is what a Buzz client needs to connect.
 */
export function JoinButton({
  className,
  communityName,
  inviteCode,
  publicUrl,
  relayUrl,
}: {
  className?: string;
  communityName: string;
  inviteCode: string | null;
  publicUrl: string | null;
  relayUrl: string;
}) {
  const [copied, setCopied] = useState(false);
  const fallbackTimer = useRef<number | null>(null);

  const openInApp = useCallback(() => {
    if (!inviteCode) return;
    const uri = buildJoinUri(relayUrl, inviteCode);

    const onHide = () => {
      if (fallbackTimer.current) {
        window.clearTimeout(fallbackTimer.current);
        fallbackTimer.current = null;
      }
    };
    document.addEventListener("visibilitychange", onHide, { once: true });

    fallbackTimer.current = window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onHide);
      window.location.href = INSTALL_URL;
    }, 1600);

    window.location.href = uri;
  }, [inviteCode, relayUrl]);

  const copyRelay = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(relayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied; the relay URL is visible elsewhere.
    }
  }, [relayUrl]);

  if (inviteCode) {
    return (
      <button
        aria-label={`Open ${communityName} in Buzz`}
        className={className}
        onClick={openInApp}
        type="button"
      >
        Open in Buzz
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
      </button>
    );
  }

  if (publicUrl) {
    return (
      <a
        className={className}
        href={publicUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        Open community
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
        </svg>
      </a>
    );
  }

  return (
    <button
      aria-label={`Copy ${communityName}'s relay URL`}
      aria-live="polite"
      className={className}
      onClick={copyRelay}
      type="button"
    >
      {copied ? (
        "Copied"
      ) : (
        <>
          Copy relay URL
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <rect height="4" rx="1" width="8" x="8" y="4" />
            <path d="M8 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
          </svg>
        </>
      )}
    </button>
  );
}
