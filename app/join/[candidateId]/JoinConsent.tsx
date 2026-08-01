"use client";

import { useCallback, useState } from "react";

import { buildJoinDeepLink } from "../../join-urls";
import styles from "./join.module.css";

type Phase = "idle" | "minting" | "launched" | "error";

/**
 * The consent step of the join flow. It shows the community's ACTUAL join policy
 * and — only when the human ticks an unchecked age/ToS box — mints a policy
 * receipt AT CLICK TIME and hands off to Buzz with a receipt-carrying deep link.
 *
 * The receipt is short-lived (~10 min) and per-code, so it is never rendered
 * into the page, cached, or reused: it is fetched from `/api/invite-receipt` in
 * the click handler and used immediately. If a hand-off fails (e.g. the receipt
 * lapsed, or the policy changed under the user), tapping again re-mints; a
 * `policy_changed` response asks the user to review the new terms.
 */
export function JoinConsent({
  ageAttestationRequired,
  candidateId,
  code,
  displayName,
  hostedFallbackUrl,
  policyUnavailable,
  policyVersion,
  privacyMarkdown,
  relayUrl,
  termsMarkdown,
}: {
  ageAttestationRequired: boolean;
  candidateId: string;
  code: string;
  displayName: string;
  hostedFallbackUrl: string;
  policyUnavailable: boolean;
  policyVersion: string;
  privacyMarkdown: string | null;
  relayUrl: string;
  termsMarkdown: string | null;
}) {
  const [agreed, setAgreed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const consentSatisfied = ageAttestationRequired ? agreed : true;

  const openInBuzz = useCallback(async () => {
    if (!consentSatisfied || phase === "minting") return;
    setPhase("minting");
    setMessage(null);
    try {
      const response = await fetch("/api/invite-receipt", {
        body: JSON.stringify({
          ageConfirmed: ageAttestationRequired ? agreed : false,
          candidateId,
          policyVersion,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setPhase("error");
        setMessage(errorMessage(body.error, response.status));
        return;
      }
      const { receipt } = (await response.json()) as { receipt: string };
      const deepLink = buildJoinDeepLink(relayUrl, code, receipt);
      setPhase("launched");
      // Hand straight off to the app while the fresh receipt is still valid.
      window.location.href = deepLink;
    } catch {
      setPhase("error");
      setMessage(
        "Couldn't reach BuzzRouter to prepare your join. Check your connection and try again.",
      );
    }
  }, [
    ageAttestationRequired,
    agreed,
    candidateId,
    code,
    consentSatisfied,
    phase,
    policyVersion,
    relayUrl,
  ]);

  if (policyUnavailable) {
    return (
      <>
        <p className={styles.lead}>
          We couldn't reach {displayName} to load its join terms right now.
        </p>
        <a
          className={styles.primary}
          href={hostedFallbackUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Continue on Buzz
        </a>
        <p className={styles.muted}>
          This opens the community's own join page, which handles the terms step
          in your browser.
        </p>
      </>
    );
  }

  return (
    <>
      <p className={styles.lead}>
        Joining {displayName} means accepting the community operator's join
        policy.
      </p>

      {termsMarkdown || privacyMarkdown ? (
        <div className={styles.policy}>
          {termsMarkdown ? (
            <PolicySection text={termsMarkdown} title="Terms of Service" />
          ) : null}
          {privacyMarkdown ? (
            <PolicySection text={privacyMarkdown} title="Privacy Notice" />
          ) : null}
        </div>
      ) : null}

      {ageAttestationRequired ? (
        <label className={styles.consent}>
          <input
            checked={agreed}
            onChange={(event) => setAgreed(event.target.checked)}
            type="checkbox"
          />
          <span>
            I am 18 or older and I agree to the Terms of Service and Privacy
            Notice above.
          </span>
        </label>
      ) : null}

      <button
        className={styles.primary}
        disabled={!consentSatisfied || phase === "minting"}
        onClick={openInBuzz}
        type="button"
      >
        {phase === "minting" ? "Preparing…" : "Open in Buzz"}
      </button>

      {phase === "launched" ? (
        <p className={styles.muted} role="status">
          Sending you to Buzz. If nothing happens, tap "Open in Buzz" again — the
          approval is only valid for a few minutes.
        </p>
      ) : null}
      {phase === "error" && message ? (
        <p className={styles.error} role="alert">
          {message}
        </p>
      ) : null}

      <a
        className={styles.secondary}
        href={hostedFallbackUrl}
        rel="noopener noreferrer"
        target="_blank"
      >
        Continue on the web instead
      </a>
    </>
  );
}

function PolicySection({ text, title }: { text: string; title: string }) {
  return (
    <details className={styles.policyDetails}>
      <summary>{title}</summary>
      <div className={styles.policyText}>{text}</div>
    </details>
  );
}

function errorMessage(code: string | undefined, status: number): string {
  if (code === "policy_changed") {
    return "This community's join policy changed. Please reload this page to review the new terms before joining.";
  }
  if (code === "age_confirmation_required") {
    return "This community requires an age confirmation. Please tick the box above.";
  }
  if (code === "no_invite") {
    return "We no longer have a working invite for this community.";
  }
  if (status >= 500) {
    return "The community's relay didn't respond. Try again in a moment, or use the web option below.";
  }
  return "Something went wrong preparing your join. Try again, or use the web option below.";
}
