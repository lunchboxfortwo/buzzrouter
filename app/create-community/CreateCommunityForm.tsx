"use client";

import { type FormEvent, useState } from "react";

import styles from "./create-community.module.css";

const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface SuccessResult {
  communityUrl: string;
  host: string;
  npub: string;
  nsec: string;
  note: string;
  resumed: boolean;
}

interface ErrorResult {
  error: string;
  message: string;
  fallbackUrl: string;
}

/** Normalize as the user types so the preview matches what the server accepts. */
function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "");
}

export function CreateCommunityForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SuccessResult | null>(null);
  const [error, setError] = useState<ErrorResult | null>(null);
  const [copied, setCopied] = useState(false);

  const normalized = normalizeName(name);
  const nameValid = NAME_RE.test(normalized);

  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy || !nameValid) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/create-community", {
        body: JSON.stringify({ email, name: normalized }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json()) as SuccessResult | ErrorResult;
      if (response.ok && "nsec" in body) {
        setResult(body);
      } else {
        setError(
          "message" in body
            ? (body as ErrorResult)
            : {
                error: "unknown",
                fallbackUrl: "https://app.builderlab.xyz",
                message: "Something went wrong. Please try again.",
              },
        );
      }
    } catch {
      setError({
        error: "network",
        fallbackUrl: "https://app.builderlab.xyz",
        message: "We couldn't reach the server. Please try again.",
      });
    } finally {
      setBusy(false);
    }
  }

  function downloadNsec(res: SuccessResult): void {
    const text =
      `BuzzRouter — your community identity\n\n` +
      `Community: ${res.host}\n` +
      `URL: ${res.communityUrl}\n` +
      `Public key (npub): ${res.npub}\n` +
      `Secret key (nsec): ${res.nsec}\n\n` +
      `Keep the secret key safe. It is the ONLY way to control this community, ` +
      `and BuzzRouter does not keep a copy.\n`;
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.download = `${res.host}-identity.txt`;
    link.href = url;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function copyNsec(nsec: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(nsec);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_000);
    } catch {
      setCopied(false);
    }
  }

  if (result) {
    return (
      <div className={styles.result}>
        <h2>Your community is live</h2>
        <p>
          <a href={result.communityUrl} rel="noopener noreferrer" target="_blank">
            {result.host}
          </a>{" "}
          is ready{result.resumed ? " (we finished an earlier attempt)" : ""}.
        </p>

        <div className={styles.keyBox}>
          <span className={styles.keyLabel}>Save your secret key (nsec)</span>
          <p className={styles.keyWarning}>{result.note}</p>
          <code className={styles.nsec}>{result.nsec}</code>
          <div className={styles.keyActions}>
            <button
              className={styles.secondaryButton}
              onClick={() => void copyNsec(result.nsec)}
              type="button"
            >
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              className={styles.secondaryButton}
              onClick={() => downloadNsec(result)}
              type="button"
            >
              Download .txt
            </button>
          </div>
          <span className={styles.npub}>Public key: {result.npub}</span>
        </div>

        <p className={styles.panelSub}>
          Next: <a href="/submit">list it</a> in the directory or{" "}
          <a href="/shared-channels">link it</a> with other communities.
        </p>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <label className={styles.field}>
        <span>Community name</span>
        <input
          autoCapitalize="none"
          autoCorrect="off"
          disabled={busy}
          name="name"
          onChange={(event) => setName(event.target.value)}
          placeholder="my-community"
          spellCheck={false}
          value={name}
        />
        {normalized && (
          <span className={styles.preview}>
            {nameValid ? (
              <>
                Will be created at{" "}
                <strong>{normalized}.communities.buzz.xyz</strong>
              </>
            ) : (
              "Use lowercase letters, digits, and single dashes."
            )}
          </span>
        )}
      </label>

      <label className={styles.field}>
        <span>Your email</span>
        <input
          disabled={busy}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          type="email"
          value={email}
        />
        <span className={styles.preview}>
          Only used to reach you about this community.
        </span>
      </label>

      {error && (
        <div className={styles.error} role="alert">
          <strong>{error.message}</strong>
          <span>
            You can create one yourself at{" "}
            <a href={error.fallbackUrl} rel="noopener noreferrer" target="_blank">
              app.builderlab.xyz
            </a>
            .
          </span>
        </div>
      )}

      <button
        className={styles.primaryButton}
        disabled={busy || !nameValid || email.length === 0}
        type="submit"
      >
        {busy ? "Creating your community…" : "Create my community"}
      </button>
      <span className={styles.panelSub}>
        We create a hosted Buzz account for you and hand you the keys. This takes
        a minute.
      </span>
    </form>
  );
}
