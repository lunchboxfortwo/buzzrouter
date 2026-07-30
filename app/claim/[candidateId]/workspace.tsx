"use client";

import { useMemo, useState } from "react";

import type { ClaimWorkspace } from "../../../src/claims/store";
import type { ClaimMethod } from "../../../src/claims/validation";

import styles from "./claim.module.css";

interface NostrProvider {
  getPublicKey(): Promise<string>;
  signEvent(event: {
    content: string;
    created_at: number;
    kind: number;
    tags: string[][];
  }): Promise<Record<string, unknown>>;
}

interface ChallengeResponse {
  challengeId: string;
  expiresAt: string;
  instructions: {
    method: ClaimMethod;
    name?: string;
    url?: string;
    value?: string;
  };
}

declare global {
  interface Window {
    nostr?: NostrProvider;
  }
}

export function ClaimWorkspaceClient({
  workspace,
}: {
  workspace: ClaimWorkspace;
}) {
  const methods = useMemo<ClaimMethod[]>(
    () =>
      workspace.host.endsWith(".communities.buzz.xyz")
        ? ["hosted_icon"]
        : ["dns_txt", "http_file"],
    [workspace.host],
  );
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [method, setMethod] = useState<ClaimMethod>(methods[0]);
  const [challenge, setChallenge] =
    useState<ChallengeResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ownsCommunity =
    pubkey !== null && workspace.ownerPubkey === pubkey;
  const claimVerified = message === "Ownership verified.";

  async function connect() {
    setMessage(null);
    if (!window.nostr) {
      setMessage("A NIP-07 signer is required.");
      return;
    }
    try {
      setPubkey(await window.nostr.getPublicKey());
    } catch {
      setMessage("Signer connection was not approved.");
    }
  }

  async function createChallenge() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await signedJson<ChallengeResponse>(
        "/api/claims/challenges",
        "POST",
        { candidateId: workspace.id, method },
      );
      setChallenge(result);
      setMessage("Proof instructions are ready.");
    } catch (error) {
      setMessage(apiMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function verifyChallenge() {
    if (!challenge) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await signedJson<{ status: string }>(
        `/api/claims/challenges/${challenge.challengeId}/verify`,
        "POST",
        {},
      );
      setMessage(
        result.status === "verified"
          ? "Ownership verified."
          : "This ownership claim requires review.",
      );
    } catch (error) {
      setMessage(apiMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span>01</span>
            <h2>Connect identity</h2>
          </div>
          <Status value={pubkey ? "Connected" : "Required"} />
        </div>
        <p>
          Sign with the Nostr key that should administer this listing.
        </p>
        {pubkey ? (
          <code className={styles.pubkey}>{pubkey}</code>
        ) : (
          <button className={styles.primary} onClick={connect} type="button">
            Connect Nostr signer
          </button>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span>02</span>
            <h2>Prove relay control</h2>
          </div>
          <Status
            value={
              ownsCommunity || claimVerified
                ? "Verified"
                : challenge
                  ? "Pending"
                  : "Required"
            }
          />
        </div>

        {ownsCommunity ? (
          <p>This signer already controls the community listing.</p>
        ) : (
          <>
            {methods.length > 1 ? (
              <div className={styles.segmented} aria-label="Proof method">
                {methods.map((value) => (
                  <button
                    aria-pressed={method === value}
                    disabled={!pubkey || busy}
                    key={value}
                    onClick={() => {
                      setMethod(value);
                      setChallenge(null);
                    }}
                    type="button"
                  >
                    {value === "dns_txt" ? "DNS TXT" : "HTTPS file"}
                  </button>
                ))}
              </div>
            ) : (
              <p>
                Hosted relay verification uses the relay&apos;s NIP-11 icon.
              </p>
            )}

            {!challenge ? (
              <button
                className={styles.primary}
                disabled={!pubkey || busy}
                onClick={createChallenge}
                type="button"
              >
                Create proof challenge
              </button>
            ) : (
              <ProofInstructions challenge={challenge} />
            )}

            {challenge ? (
              <button
                className={styles.primary}
                disabled={busy || claimVerified}
                onClick={verifyChallenge}
                type="button"
              >
                Check proof
              </button>
            ) : null}
          </>
        )}
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeading}>
          <div>
            <span>03</span>
            <h2>Publish listing</h2>
          </div>
          <Status
            value={ownsCommunity || claimVerified ? "Available" : "Locked"}
          />
        </div>
        {ownsCommunity || claimVerified ? (
          <ListingForm
            candidateId={workspace.id}
            workspace={workspace}
          />
        ) : (
          <p>Verified ownership unlocks listing metadata and visibility.</p>
        )}
      </section>

      {message ? (
        <p aria-live="polite" className={styles.notice}>
          {message}
        </p>
      ) : null}
    </>
  );
}

function ProofInstructions({
  challenge,
}: {
  challenge: ChallengeResponse;
}) {
  return (
    <div className={styles.instructions}>
      {challenge.instructions.name ? (
        <Instruction
          label="Record name"
          value={challenge.instructions.name}
        />
      ) : null}
      {challenge.instructions.url ? (
        <Instruction label="Location" value={challenge.instructions.url} />
      ) : null}
      {challenge.instructions.value ? (
        <Instruction label="Value" value={challenge.instructions.value} />
      ) : null}
      <span>
        Expires{" "}
        {new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(new Date(challenge.expiresAt))}
      </span>
    </div>
  );
}

function Instruction({ label, value }: { label: string; value: string }) {
  return (
    <label className={styles.instruction}>
      <span>{label}</span>
      <code>{value}</code>
    </label>
  );
}

function ListingForm({
  candidateId,
  workspace,
}: {
  candidateId: string;
  workspace: ClaimWorkspace;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage(null);
    const visibility = String(formData.get("visibility"));
    const joinMode = String(formData.get("joinMode"));
    try {
      const result = await signedJson<{
        slug: string;
        visibility: string;
      }>(`/api/communities/${candidateId}`, "PUT", {
        categories: String(formData.get("categories"))
          .split(",")
          .map((value) => value.trim().toLowerCase())
          .filter(Boolean),
        description: String(formData.get("description")),
        displayName: String(formData.get("displayName")),
        joinMode,
        joinUrl:
          joinMode === "invite_required"
            ? null
            : String(formData.get("joinUrl")),
        slug: String(formData.get("slug")),
        visibility,
      });
      setMessage(
        result.visibility === "public"
          ? `Published at /communities/${result.slug}`
          : "Draft saved.",
      );
    } catch (error) {
      setMessage(apiMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className={styles.form}>
      <div className={styles.grid}>
        <label>
          Display name
          <input
            defaultValue={workspace.displayName ?? ""}
            maxLength={80}
            minLength={2}
            name="displayName"
            required
          />
        </label>
        <label>
          URL slug
          <input
            defaultValue={workspace.slug ?? ""}
            maxLength={50}
            minLength={3}
            name="slug"
            pattern="[a-z0-9][a-z0-9-]+[a-z0-9]"
            placeholder="builders-lab"
            required
          />
        </label>
      </div>
      <label>
        Description
        <textarea
          defaultValue={workspace.description ?? ""}
          maxLength={500}
          name="description"
          required
          rows={4}
        />
      </label>
      <label>
        Categories
        <input
          defaultValue={workspace.categories.join(", ")}
          name="categories"
          placeholder="agents, developer-tools"
        />
      </label>
      <div className={styles.grid}>
        <label>
          Join mode
          <select defaultValue={workspace.joinMode} name="joinMode">
            <option value="invite_required">Invite required</option>
            <option value="request_invite">Request invite</option>
            <option value="public_link">Public link</option>
          </select>
        </label>
        <label>
          Join URL
          <input
            defaultValue={workspace.joinUrl ?? ""}
            name="joinUrl"
            placeholder="https://..."
            type="url"
          />
        </label>
      </div>
      <label>
        Visibility
        <select defaultValue={workspace.visibility} name="visibility">
          <option value="internal">Private draft</option>
          <option value="public">Public listing</option>
        </select>
      </label>
      <button className={styles.primary} disabled={busy} type="submit">
        Save listing
      </button>
      {message ? <p aria-live="polite">{message}</p> : null}
    </form>
  );
}

function Status({ value }: { value: string }) {
  return <span className={styles.status}>{value}</span>;
}

async function signedJson<T>(
  path: string,
  method: "POST" | "PUT",
  value: unknown,
): Promise<T> {
  if (!window.nostr) {
    throw new Error("signer_required");
  }

  const body = JSON.stringify(value);
  const url = new URL(path, window.location.origin).toString();
  const payload = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(body),
  );
  const payloadHex = [...new Uint8Array(payload)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const event = await window.nostr.signEvent({
    content: "",
    created_at: Math.floor(Date.now() / 1_000),
    kind: 27_235,
    tags: [
      ["u", url],
      ["method", method],
      ["payload", payloadHex],
    ],
  });
  const authorization = bytesToBase64(
    new TextEncoder().encode(JSON.stringify(event)),
  );
  const response = await fetch(url, {
    body,
    headers: {
      authorization: `Nostr ${authorization}`,
      "content-type": "application/json",
    },
    method,
  });
  const result = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(result.error ?? "request_failed");
  }
  return result;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function apiMessage(error: unknown): string {
  const code = error instanceof Error ? error.message : "request_failed";
  const messages: Record<string, string> = {
    authentication_invalid: "The signed request was not accepted.",
    authentication_replayed: "That signature was already used. Try again.",
    candidate_not_verified: "This relay needs a fresh Buzz verification.",
    claim_conflict: "Another verified owner controls this listing.",
    proof_not_found: "The proof is not visible yet.",
    signer_required: "A NIP-07 signer is required.",
  };
  return messages[code] ?? "The request could not be completed.";
}
