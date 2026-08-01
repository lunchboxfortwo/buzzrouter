"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "./join.module.css";

interface IdentityView {
  exportedAt: string | null;
  memberships: { relayHost: string }[];
  npub: string;
}

interface Outcome {
  reason?: string;
  status:
    | "joined"
    | "already_joined"
    | "refused"
    | "not_joinable"
    | "unreachable"
    | "rate_limited"
    | "error";
}

type JoinState = "idle" | "joining" | "joined" | "error";

export function ManagedIdentityJoin({
  candidateId,
  disabled,
  prepareReceipt,
  relayHost,
}: {
  candidateId: string;
  disabled: boolean;
  prepareReceipt: () => Promise<string>;
  relayHost: string;
}) {
  const [identity, setIdentity] = useState<IdentityView | null | undefined>(
    undefined,
  );
  const [joinState, setJoinState] = useState<JoinState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [secret, setSecret] = useState<{ npub: string; nsec: string } | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/identity", { headers: { accept: "application/json" } })
      .then((response) => response.json())
      .then((data: { identity: IdentityView | null }) => {
        if (cancelled) return;
        const current = data.identity ?? null;
        setIdentity(current);
        if (current?.memberships.some((item) => item.relayHost === relayHost)) {
          setJoinState("joined");
        }
      })
      .catch(() => {
        if (!cancelled) setIdentity(null);
      });
    return () => {
      cancelled = true;
    };
  }, [relayHost]);

  const ensureIdentity = useCallback(async (): Promise<IdentityView> => {
    if (identity) return identity;
    const response = await fetch("/api/identity", { method: "POST" });
    if (!response.ok) {
      throw new Error("Could not set up your identity. Try again in a minute.");
    }
    const data = (await response.json()) as { identity: IdentityView };
    setIdentity(data.identity);
    return data.identity;
  }, [identity]);

  const joinWithoutBuzz = useCallback(async () => {
    if (joinState === "joining" || joinState === "joined") return;
    setJoinState("joining");
    setMessage(null);
    try {
      const policyReceipt = await prepareReceipt();
      const currentIdentity = await ensureIdentity();
      const response = await fetch("/api/identity/join", {
        body: JSON.stringify({ candidateId, policyReceipt }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      if (response.status === 429) {
        throw new Error("You're joining too fast. Wait a moment and try again.");
      }
      const data = (await response.json()) as { outcome?: Outcome };
      const outcome = data.outcome;
      if (outcome?.status === "joined" || outcome?.status === "already_joined") {
        setJoinState("joined");
        setIdentity({
          ...currentIdentity,
          memberships: dedupeMemberships(currentIdentity.memberships, relayHost),
        });
        setMessage("Joined. You can use this identity again on this device.");
        return;
      }
      throw new Error(outcomeMessage(outcome));
    } catch (error) {
      setJoinState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Review the terms and try again.",
      );
    }
  }, [candidateId, ensureIdentity, joinState, prepareReceipt, relayHost]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const response = await fetch("/api/identity/export", { method: "POST" });
      if (!response.ok) return;
      const data = (await response.json()) as { npub: string; nsec: string };
      setSecret(data);
      setIdentity((current) =>
        current
          ? { ...current, exportedAt: current.exportedAt ?? new Date().toISOString() }
          : current,
      );
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <section className={styles.keyless}>
      <h2>Don&apos;t have Buzz? Join without installing anything.</h2>
      <div className={styles.custody}>
        <h3>BuzzRouter holds your key</h3>
        <p>
          The identity you join with is a Nostr key that lives{" "}
          <strong>encrypted on our servers</strong>. That&apos;s what makes one-tap
          join possible — but it also means we technically can act as this
          identity. We never share the raw key unless you export it.
        </p>
        {identity === undefined ? (
          <p className={styles.custodyMeta}>Checking for a saved identity…</p>
        ) : identity ? (
          <>
            <p className={styles.custodyMeta}>
              Your identity: <code>{identity.npub}</code>
            </p>
            <div className={styles.custodyActions}>
              <button
                className={styles.exportButton}
                disabled={exporting}
                onClick={handleExport}
                type="button"
              >
                {exporting ? "Preparing…" : "Export my key"}
              </button>
              {identity.exportedAt ? (
                <span className={styles.exportedFlag}>
                  Exported — a copy exists outside our custody.
                </span>
              ) : null}
            </div>
          </>
        ) : (
          <p className={styles.custodyMeta}>
            We&apos;ll create and hold a key for you when you join.
          </p>
        )}
      </div>

      <button
        className={styles.keylessButton}
        disabled={disabled || joinState === "joining" || joinState === "joined"}
        onClick={joinWithoutBuzz}
        type="button"
      >
        {joinState === "joining"
          ? "Joining…"
          : joinState === "joined"
            ? "Joined"
            : "Join without Buzz"}
      </button>
      {message ? (
        <p
          className={joinState === "error" ? styles.error : styles.success}
          role={joinState === "error" ? "alert" : "status"}
        >
          {message}
        </p>
      ) : null}

      {secret ? (
        <ExportModal secret={secret} onClose={() => setSecret(null)} />
      ) : null}
    </section>
  );
}

function dedupeMemberships(
  memberships: { relayHost: string }[],
  relayHost: string,
): { relayHost: string }[] {
  if (memberships.some((item) => item.relayHost === relayHost)) return memberships;
  return [...memberships, { relayHost }];
}

function outcomeMessage(outcome: Outcome | undefined): string {
  switch (outcome?.status) {
    case "refused":
      return outcome.reason ?? "This community declined the join request.";
    case "not_joinable":
      return "This community no longer has a working invite.";
    case "unreachable":
      return "Couldn't reach the community's relay. Try again later.";
    case "rate_limited":
      return "The community is rate-limiting joins. Try again shortly.";
    default:
      return "The join didn't complete. Review the terms and try again.";
  }
}

function ExportModal({
  secret,
  onClose,
}: {
  secret: { npub: string; nsec: string };
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard
      ?.writeText(secret.nsec)
      .then(() => setCopied(true))
      .catch(() => setCopied(false));
  }, [secret.nsec]);

  const download = useCallback(() => {
    const blob = new Blob(
      [`# BuzzRouter managed identity\n${secret.npub}\n${secret.nsec}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.download = "buzzrouter-identity.txt";
    anchor.href = url;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [secret]);

  return (
    <div aria-modal="true" className={styles.modalOverlay} role="dialog">
      <div className={styles.modal}>
        <h2>Your private key</h2>
        <p className={styles.warn}>
          This is the secret for your identity. Anyone who has it fully controls
          it. We&apos;re showing it once — copy or download it now and keep it
          somewhere safe. Exporting means the key now exists outside BuzzRouter&apos;s
          custody.
        </p>
        <span className={styles.secretLabel}>Public key (npub)</span>
        <code className={styles.secretBox}>{secret.npub}</code>
        <span className={styles.secretLabel}>Private key (nsec)</span>
        <code className={`${styles.secretBox} ${styles.secretMono}`}>
          {secret.nsec}
        </code>
        <div className={styles.buttonRow}>
          <button className={styles.keylessButton} onClick={copy} type="button">
            {copied ? "Copied" : "Copy nsec"}
          </button>
          <button className={styles.exportButton} onClick={download} type="button">
            Download
          </button>
          <button className={styles.dismissButton} onClick={onClose} type="button">
            I&apos;ve saved it
          </button>
        </div>
      </div>
    </div>
  );
}
