"use client";

import { useState } from "react";

/**
 * The directory's one piece of client interactivity: copying a verified
 * relay's canonical URL. Everything else on the page is server-rendered and
 * URL-driven, so this stays a small, self-contained island.
 */
export function CopyRelayButton({
  className,
  communityName,
  relayUrl,
}: {
  className?: string;
  communityName: string;
  relayUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(relayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied or unavailable; the relay URL is
      // still visible elsewhere on the page, so we fail silently.
    }
  }

  return (
    <button
      aria-label={`Copy ${communityName}'s relay URL`}
      aria-live="polite"
      className={className}
      onClick={handleCopy}
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
