"use client";

import { useCallback, useEffect, useState } from "react";

import styles from "./join.module.css";

export interface JoinableCommunity {
  description: string | null;
  displayName: string;
  focus: string | null;
  host: string;
}

interface IdentityView {
  exportedAt: string | null;
  memberships: { relayHost: string }[];
  npub: string;
}

type RowState =
  | { kind: "idle" }
  | { kind: "joining" }
  | { kind: "joined" }
  | { kind: "note"; message: string }
  | { kind: "error"; message: string };

export function JoinClient({
  communities,
}: {
  communities: JoinableCommunity[];
}) {
  const [identity, setIdentity] = useState<IdentityView | null | undefined>(
    undefined,
  );
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [secret, setSecret] = useState<{ npub: string; nsec: string } | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/identity", { headers: { accept: "application/json" } })
      .then((response) => response.json())
      .then((data: { identity: IdentityView | null }) => {
        if (!cancelled) setIdentity(data.identity ?? null);
      })
      .catch(() => {
        if (!cancelled) setIdentity(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const joinedHosts = new Set(
    (identity?.memberships ?? []).map((m) => m.relayHost),
  );

  const setRow = useCallback((host: string, state: RowState) => {
    setRows((prev) => ({ ...prev, [host]: state }));
  }, []);

  const ensureIdentity = useCallback(async (): Promise<boolean> => {
    if (identity) return true;
    const response = await fetch("/api/identity", { method: "POST" });
    if (!response.ok) return false;
    const data = (await response.json()) as { identity: IdentityView };
    setIdentity(data.identity);
    return true;
  }, [identity]);

  const handleJoin = useCallback(
    async (host: string) => {
      setRow(host, { kind: "joining" });
      try {
        if (!(await ensureIdentity())) {
          setRow(host, {
            kind: "error",
            message: "Could not set up your identity. Try again in a minute.",
          });
          return;
        }
        const response = await fetch("/api/identity/join", {
          body: JSON.stringify({ relayHost: host }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        if (response.status === 429) {
          setRow(host, {
            kind: "error",
            message: "You're joining too fast. Wait a moment and try again.",
          });
          return;
        }
        const data = (await response.json()) as { outcome?: Outcome };
        applyOutcome(host, data.outcome, setRow, () =>
          setIdentity((prev) =>
            prev
              ? {
                  ...prev,
                  memberships: dedupeMemberships(prev.memberships, host),
                }
              : prev,
          ),
        );
      } catch {
        setRow(host, {
          kind: "error",
          message: "Something went wrong. Try again.",
        });
      }
    },
    [ensureIdentity, setRow],
  );

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const response = await fetch("/api/identity/export", { method: "POST" });
      if (!response.ok) return;
      const data = (await response.json()) as { npub: string; nsec: string };
      setSecret(data);
      setIdentity((prev) =>
        prev
          ? { ...prev, exportedAt: prev.exportedAt ?? new Date().toISOString() }
          : prev,
      );
    } finally {
      setExporting(false);
    }
  }, []);

  return (
    <>
      <CustodyPanel
        exporting={exporting}
        identity={identity}
        onExport={handleExport}
      />

      <ul className={styles.list}>
        {communities.map((community) => {
          const joined = joinedHosts.has(community.host);
          const state: RowState = joined
            ? { kind: "joined" }
            : (rows[community.host] ?? { kind: "idle" });
          return (
            <li className={styles.row} key={community.host}>
              <div className={styles.rowMain}>
                <span className={styles.rowName}>{community.displayName}</span>
                {community.description ? (
                  <span className={styles.rowDesc}>{community.description}</span>
                ) : null}
                <span className={styles.rowMeta}>
                  {community.host}
                  {community.focus ? ` · ${community.focus}` : ""}
                </span>
              </div>
              <div className={styles.rowAction}>
                <RowStatus state={state} />
                <button
                  className={styles.joinButton}
                  disabled={state.kind === "joining" || state.kind === "joined"}
                  onClick={() => handleJoin(community.host)}
                  type="button"
                >
                  {state.kind === "joined"
                    ? "Joined"
                    : state.kind === "joining"
                      ? "Joining…"
                      : "Join"}
                </button>
              </div>
            </li>
          );
        })}
        {communities.length === 0 ? (
          <li className={styles.empty}>
            No communities are open for one-tap join right now.
          </li>
        ) : null}
      </ul>

      {secret ? (
        <ExportModal secret={secret} onClose={() => setSecret(null)} />
      ) : null}
    </>
  );
}

interface Outcome {
  reason?: string;
  relayHost: string;
  status:
    | "joined"
    | "already_joined"
    | "refused"
    | "not_joinable"
    | "unreachable"
    | "rate_limited"
    | "error";
}

function applyOutcome(
  host: string,
  outcome: Outcome | undefined,
  setRow: (host: string, state: RowState) => void,
  onJoined: () => void,
): void {
  switch (outcome?.status) {
    case "joined":
    case "already_joined":
      setRow(host, { kind: "joined" });
      onJoined();
      return;
    case "refused":
      setRow(host, {
        kind: "note",
        message: outcome.reason ?? "This community declined the request.",
      });
      return;
    case "not_joinable":
      setRow(host, {
        kind: "note",
        message: "This community isn't open for one-tap join.",
      });
      return;
    case "unreachable":
      setRow(host, {
        kind: "error",
        message: "Couldn't reach the community's relay. Try again later.",
      });
      return;
    case "rate_limited":
      setRow(host, {
        kind: "error",
        message: "The community is rate-limiting joins. Try again shortly.",
      });
      return;
    default:
      setRow(host, { kind: "error", message: "The join didn't complete." });
  }
}

function dedupeMemberships(
  memberships: { relayHost: string }[],
  host: string,
): { relayHost: string }[] {
  if (memberships.some((m) => m.relayHost === host)) return memberships;
  return [...memberships, { relayHost: host }];
}

function RowStatus({ state }: { state: RowState }) {
  if (state.kind === "note") {
    return <span className={styles.statusNote}>{state.message}</span>;
  }
  if (state.kind === "error") {
    return <span className={styles.statusError}>{state.message}</span>;
  }
  return null;
}

function CustodyPanel({
  exporting,
  identity,
  onExport,
}: {
  exporting: boolean;
  identity: IdentityView | null | undefined;
  onExport: () => void;
}) {
  return (
    <section className={styles.custody}>
      <h2>BuzzRouter holds your key</h2>
      <p>
        The identity you join with is a Nostr key that lives{" "}
        <strong>encrypted on our servers</strong>. That's what makes one-tap join
        possible — but it also means we technically can act as this identity. We
        never share the raw key unless you export it.
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
              onClick={onExport}
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
          We'll create and hold a key for you the first time you join.
        </p>
      )}
    </section>
  );
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
    <div className={styles.modalOverlay} role="dialog" aria-modal="true">
      <div className={styles.modal}>
        <h2>Your private key</h2>
        <p className={styles.warn}>
          This is the secret for your identity. Anyone who has it fully controls
          it. We're showing it once — copy or download it now and keep it
          somewhere safe. Exporting means the key now exists outside BuzzRouter's
          custody.
        </p>
        <label className={styles.secretLabel}>Public key (npub)</label>
        <code className={styles.secretBox}>{secret.npub}</code>
        <label className={styles.secretLabel}>Private key (nsec)</label>
        <code className={`${styles.secretBox} ${styles.secretMono}`}>
          {secret.nsec}
        </code>
        <div className={styles.buttonRow}>
          <button className={styles.joinButton} onClick={copy} type="button">
            {copied ? "Copied" : "Copy nsec"}
          </button>
          <button
            className={styles.exportButton}
            onClick={download}
            type="button"
          >
            Download
          </button>
          <button
            className={styles.dismissButton}
            onClick={onClose}
            type="button"
          >
            I've saved it
          </button>
        </div>
      </div>
    </div>
  );
}
