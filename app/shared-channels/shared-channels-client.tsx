"use client";

import { useEffect, useMemo, useState } from "react";

import {
  getBrowserNostrProvider,
  signedRequest,
} from "../../src/http/nostr-client";
import type {
  SharedChannelAdminRecord,
  SharedChannelAdminWorkspace,
  SharedChannelCommunitySummary,
} from "../../src/shared-channels/store";

import styles from "./shared-channels.module.css";

type Action = "accept" | "reject" | "pause" | "resume" | "disconnect";

interface InstallTokenResponse {
  bridgePubkey: string;
  command: string;
  expiresAt: string;
  relayUrl: string;
}

export function SharedChannelsClient() {
  const [workspace, setWorkspace] =
    useState<SharedChannelAdminWorkspace | null>(null);
  const [activeCommunityId, setActiveCommunityId] = useState("");
  const [pubkey, setPubkey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [install, setInstall] = useState<InstallTokenResponse | null>(
    null,
  );
  const [signerPresent, setSignerPresent] = useState(true);

  useEffect(() => {
    setSignerPresent(getBrowserNostrProvider() !== null);
  }, []);

  const activeCommunity = workspace?.communities.find(
    (community) => community.id === activeCommunityId,
  );
  const channels = useMemo(
    () =>
      workspace?.channels.filter(
        (channel) => channel.ownCommunityId === activeCommunityId,
      ) ?? [],
    [activeCommunityId, workspace],
  );

  async function connect() {
    const nostr = getBrowserNostrProvider();
    if (!nostr) {
      setMessage("A Nostr signer is required.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const signerPubkey = await nostr.getPublicKey();
      const next = await signedRequest<SharedChannelAdminWorkspace>(
        "/api/shared-channels",
        "GET",
      );
      setPubkey(signerPubkey);
      setWorkspace(next);
      setInstall(null);
      setActiveCommunityId((current) =>
        next.communities.some((community) => community.id === current)
          ? current
          : (next.communities[0]?.id ?? ""),
      );
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    const next = await signedRequest<SharedChannelAdminWorkspace>(
      "/api/shared-channels",
      "GET",
    );
    setWorkspace(next);
  }

  async function runAction(
    channel: SharedChannelAdminRecord,
    action: Action,
    extra: Record<string, string> = {},
  ) {
    setBusy(true);
    setMessage("");
    try {
      await signedRequest(
        `/api/shared-channels/${channel.id}/${action}`,
        "POST",
        {
          communityId: activeCommunityId,
          idempotencyKey: crypto.randomUUID(),
          ...extra,
        },
      );
      await refresh();
      setMessage(actionMessage(action));
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createInstallCommand() {
    setBusy(true);
    setMessage("");
    try {
      const result = await signedRequest<InstallTokenResponse>(
        "/api/community-connections/install-token",
        "POST",
        { communityId: activeCommunityId },
      );
      setInstall(result);
      setMessage("Install command ready.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!workspace) {
    return (
      <section className={styles.connectPanel}>
        <div>
          <h2>Connect your owner key</h2>
          <p>Manage invitations and active routes for verified communities.</p>
        </div>
        <button
          disabled={busy || !signerPresent}
          onClick={connect}
          type="button"
        >
          {busy ? "Connecting..." : "Connect signer"}
        </button>
        {!signerPresent ? (
          <p className={styles.signerHelp}>
            No Nostr signer was detected in this browser. Install a NIP-07
            signer extension such as{" "}
            <a href="https://getalby.com" rel="noopener noreferrer" target="_blank">
              Alby
            </a>{" "}
            or{" "}
            <a
              href="https://github.com/fiatjaf/nos2x"
              rel="noopener noreferrer"
              target="_blank"
            >
              nos2x
            </a>
            , import the key that owns your community, and reload this page.
            BuzzRouter never asks for the private key itself &mdash; the
            extension signs requests on your behalf.
            <br />
            <br />
            Prefer not to use a browser extension? Every action on this page
            is also available from a terminal:{" "}
            <code className={styles.commandShape}>
              BUZZROUTER_ADMIN_KEY=nsec... npm run admin -- GET
              /api/shared-channels
            </code>{" "}
            signs the same request with a local key. See{" "}
            <a
              href="https://github.com/lunchboxfortwo/buzzrouter/blob/main/docs/admin-without-a-browser-signer.md"
              rel="noopener noreferrer"
              target="_blank"
            >
              the CLI guide
            </a>
            .
          </p>
        ) : null}
        {message ? <p className={styles.notice}>{message}</p> : null}
      </section>
    );
  }

  if (workspace.communities.length === 0) {
    return (
      <section className={styles.empty}>
        <h2>No owned communities</h2>
        <p>This signer is not the verified owner of a Buzz community.</p>
      </section>
    );
  }

  return (
    <div className={styles.workspace}>
      <section className={styles.toolbar}>
        <label>
          Community
          <select
            aria-label="Community"
            onChange={(event) => setActiveCommunityId(event.target.value)}
            value={activeCommunityId}
          >
            {workspace.communities.map((community) => (
              <option key={community.id} value={community.id}>
                {community.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className={styles.identity}>
          <span>Owner</span>
          <code>{shortKey(pubkey)}</code>
        </div>
        <button className={styles.secondary} onClick={connect} type="button">
          Refresh
        </button>
      </section>

      {activeCommunity ? (
        <ConnectionStatus
          busy={busy}
          community={activeCommunity}
          onConnect={createInstallCommand}
        />
      ) : null}

      {install ? <InstallerCommand install={install} /> : null}

      {activeCommunity?.connectionState === "active" ? (
        <ProposalForm
          activeCommunityId={activeCommunityId}
          destinations={workspace.destinations}
          onCreated={async () => {
            await refresh();
            setMessage("Invitation sent.");
          }}
          setBusy={setBusy}
          setMessage={setMessage}
        />
      ) : null}

      <section className={styles.channelSection}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Routes</h2>
            <p>Invitations and channels connected to this community.</p>
          </div>
          <span>{channels.length}</span>
        </div>
        {channels.length === 0 ? (
          <div className={styles.empty}>
            <p>No shared channels yet.</p>
          </div>
        ) : (
          <div className={styles.channelList}>
            {channels.map((channel) => (
              <ChannelRow
                busy={busy}
                channel={channel}
                key={channel.id}
                onAction={runAction}
              />
            ))}
          </div>
        )}
      </section>
      {message ? (
        <p aria-live="polite" className={styles.notice}>
          {message}
        </p>
      ) : null}
    </div>
  );
}

function ConnectionStatus({
  busy,
  community,
  onConnect,
}: {
  busy: boolean;
  community: SharedChannelCommunitySummary;
  onConnect: () => Promise<void>;
}) {
  const connected = community.connectionState === "active";
  return (
    <section className={styles.connection}>
      <div>
        <span className={connected ? styles.goodDot : styles.mutedDot} />
        <div>
          <strong>{connected ? "Connector active" : "Connector required"}</strong>
          <p>{community.relayUrl}</p>
        </div>
      </div>
      {connected ? (
        <span className={styles.state}>{community.connectionHealth}</span>
      ) : (
        <button disabled={busy} onClick={onConnect} type="button">
          Connect Buzz
        </button>
      )}
    </section>
  );
}

function InstallerCommand({
  install,
}: {
  install: InstallTokenResponse;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(install.command);
    setCopied(true);
  }

  return (
    <section className={styles.installer}>
      <div>
        <span>One-time command</span>
        <code>{install.command}</code>
      </div>
      <button className={styles.secondary} onClick={copy} type="button">
        {copied ? "Copied" : "Copy command"}
      </button>
    </section>
  );
}

function ProposalForm({
  activeCommunityId,
  destinations,
  onCreated,
  setBusy,
  setMessage,
}: {
  activeCommunityId: string;
  destinations: SharedChannelCommunitySummary[];
  onCreated: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string) => void;
}) {
  const eligible = destinations.filter(
    (community) => community.id !== activeCommunityId,
  );
  const featured = eligible.find((community) => community.featured);

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    try {
      await signedRequest("/api/shared-channels", "POST", {
        destinationCommunityId: formData.get("destinationCommunityId"),
        idempotencyKey: crypto.randomUUID(),
        proposedName: formData.get("proposedName"),
        purpose: formData.get("purpose"),
        sourceChannelId: formData.get("sourceChannelId"),
        sourceChannelName: formData.get("sourceChannelName"),
        sourceCommunityId: activeCommunityId,
      });
      await onCreated();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form action={submit} className={styles.proposal}>
      <div className={styles.sectionHeading}>
        <div>
          <h2>Share a channel</h2>
          <p>Invite another verified community to a two-way route.</p>
        </div>
      </div>
      {featured ? (
        <p className={styles.featuredHint}>
          <strong>New to shared channels?</strong> {featured.displayName} is
          selected by default. It is BuzzRouter&apos;s own community &mdash;
          a good first route for trying the flow end to end, asking for help,
          or reporting an issue.
        </p>
      ) : null}
      <div className={styles.formGrid}>
        <label>
          Destination community
          <select
            defaultValue={featured?.id}
            name="destinationCommunityId"
            required
          >
            {eligible.map((community) => (
              <option key={community.id} value={community.id}>
                {community.displayName}
                {community.featured ? " — BuzzRouter (start here)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Shared name
          <input
            maxLength={80}
            name="proposedName"
            placeholder="benchmark-review"
            required
          />
        </label>
        <label>
          Local channel ID
          <input maxLength={200} name="sourceChannelId" required />
        </label>
        <label>
          Local channel name
          <input maxLength={80} name="sourceChannelName" required />
        </label>
        <label className={styles.fullWidth}>
          Purpose
          <textarea maxLength={500} name="purpose" required rows={3} />
        </label>
      </div>
      <button disabled={eligible.length === 0} type="submit">
        Send invitation
      </button>
    </form>
  );
}

function ChannelRow({
  busy,
  channel,
  onAction,
}: {
  busy: boolean;
  channel: SharedChannelAdminRecord;
  onAction: (
    channel: SharedChannelAdminRecord,
    action: Action,
    extra?: Record<string, string>,
  ) => Promise<void>;
}) {
  const incoming =
    channel.state === "proposed" &&
    channel.proposedByCommunityId !== channel.ownCommunityId;

  return (
    <article className={styles.channel} data-channel-id={channel.id}>
      <div className={styles.channelMain}>
        <div className={styles.channelTitle}>
          <h3>{channel.proposedName}</h3>
          <span className={styles.state}>{channel.ownEndpointState}</span>
        </div>
        <p>{channel.purpose}</p>
        <span className={styles.peer}>
          with {channel.peerDisplayName}, peer {channel.peerEndpointState}
        </span>
      </div>
      <div className={styles.channelActions}>
        {incoming ? (
          <AcceptControls
            busy={busy}
            channel={channel}
            onAction={onAction}
          />
        ) : null}
        {channel.state === "proposed" && !incoming ? (
          <span className={styles.pending}>Awaiting acceptance</span>
        ) : null}
        {channel.state === "active" &&
        channel.ownEndpointState === "active" ? (
          <button
            className={styles.secondary}
            disabled={busy}
            onClick={() => onAction(channel, "pause")}
            type="button"
          >
            Pause
          </button>
        ) : null}
        {channel.state === "active" &&
        channel.ownEndpointState === "paused" ? (
          <button
            disabled={busy}
            onClick={() => onAction(channel, "resume")}
            type="button"
          >
            Resume
          </button>
        ) : null}
        {channel.state === "active" ? (
          <button
            className={styles.danger}
            disabled={busy}
            onClick={() => onAction(channel, "disconnect")}
            type="button"
          >
            Disconnect
          </button>
        ) : null}
      </div>
    </article>
  );
}

function AcceptControls({
  busy,
  channel,
  onAction,
}: {
  busy: boolean;
  channel: SharedChannelAdminRecord;
  onAction: (
    channel: SharedChannelAdminRecord,
    action: Action,
    extra?: Record<string, string>,
  ) => Promise<void>;
}) {
  const [channelId, setChannelId] = useState("");
  const [channelName, setChannelName] = useState("");

  return (
    <>
      <input
        aria-label="Local channel ID"
        onChange={(event) => setChannelId(event.target.value)}
        placeholder="Local channel ID"
        value={channelId}
      />
      <input
        aria-label="Local channel name"
        onChange={(event) => setChannelName(event.target.value)}
        placeholder="Local channel name"
        value={channelName}
      />
      <button
        disabled={busy || !channelId.trim() || !channelName.trim()}
        onClick={() =>
          onAction(channel, "accept", {
            localChannelId: channelId,
            localChannelName: channelName,
          })
        }
        type="button"
      >
        Accept
      </button>
      <button
        className={styles.secondary}
        disabled={busy}
        onClick={() => onAction(channel, "reject")}
        type="button"
      >
        Reject
      </button>
    </>
  );
}

function actionMessage(action: Action): string {
  return {
    accept: "Shared channel active.",
    disconnect: "Shared channel disconnected.",
    pause: "Your endpoint is paused.",
    reject: "Invitation rejected.",
    resume: "Your endpoint is active.",
  }[action];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed.";
}

function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
}
