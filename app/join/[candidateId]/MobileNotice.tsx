"use client";

import { useCallback, useState } from "react";

import styles from "./join.module.css";
import { MOBILE_JOIN_NOTICE } from "./mobile-notice";

/**
 * Phone visitors get the truth plus the one action that actually helps: take
 * the link to a computer. Every in-app route dead-ends today (see the notes on
 * MOBILE_JOIN_NOTICE), so offering another button that fails would be worse
 * than saying so.
 */
export function MobileNotice() {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be denied; the URL is in the address bar either way.
    }
  }, []);

  return (
    <aside className={styles.mobileNotice} role="note">
      <p className={styles.mobileNoticeTitle}>{MOBILE_JOIN_NOTICE.title}</p>
      <p className={styles.muted}>{MOBILE_JOIN_NOTICE.body}</p>
      <button
        aria-live="polite"
        className={styles.mobileNoticeCopy}
        onClick={copy}
        type="button"
      >
        {copied ? MOBILE_JOIN_NOTICE.copiedLabel : MOBILE_JOIN_NOTICE.copyLabel}
      </button>
    </aside>
  );
}
