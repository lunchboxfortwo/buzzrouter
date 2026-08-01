"use client";

import { useCallback, useState } from "react";

import type { JoinStatus } from "../src/directory/joinability";
import { launchJoin } from "./joinCascade";

/**
 * One join action per community.
 *
 * - Admission restricted (owner-only / allowlist): say "Request an invite" — a
 *   code alone will not get in, so we set expectations instead of handing over a
 *   join button that dead-ends.
 * - Invite code (open / policy-gated / not-yet-probed) or public URL: the shared
 *   join cascade in `joinCascade.ts` (the relay's hosted invite page, which runs
 *   the full policy handshake, or the web experience).
 * - Nothing joinable (or a stale code): copy the relay URL, which is what a Buzz
 *   client needs to connect.
 */
export function JoinButton({
  className,
  communityName,
  inviteCode,
  joinStatus = null,
  publicUrl,
  relayUrl,
}: {
  className?: string;
  communityName: string;
  inviteCode: string | null;
  joinStatus?: JoinStatus | null;
  publicUrl: string | null;
  relayUrl: string;
}) {
  const [copied, setCopied] = useState(false);

  const openInApp = useCallback(() => {
    launchJoin({ inviteCode, publicUrl: null, relayUrl });
  }, [inviteCode, relayUrl]);

  // A restricted (owner-only / allowlist) community can't be joined with a code:
  // surface that instead of a launch button that would be refused.
  const restricted = !publicUrl && joinStatus === "restricted";
  // A stale (expired/invalid) code has no working join path; don't offer it.
  const codeJoinable = !!inviteCode && joinStatus !== "stale" && !restricted;

  const copyRelay = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(relayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard can be denied; the relay URL is visible elsewhere.
    }
  }, [relayUrl]);

  if (restricted) {
    return (
      <span
        aria-label={`${communityName} is invite-only — request an invite from an admin`}
        className={className}
        role="note"
      >
        Request an invite
      </span>
    );
  }

  if (codeJoinable) {
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
