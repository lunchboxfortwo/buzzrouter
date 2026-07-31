"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  getBrowserNostrProvider,
  signedRequest,
} from "../../src/http/nostr-client";
import type { ClaimableCandidateMatch } from "../../src/claims/store";
import type { LocalChannelListing } from "../../src/shared-channels/local-channels";
import type {
  SharedChannelAdminRecord,
  SharedChannelAdminWorkspace,
  SharedChannelCommunitySummary,
} from "../../src/shared-channels/store";

import { errorMessage } from "./error-message";
import styles from "./shared-channels.module.css";

interface LocalChannelSelection {
  channelId: string;
  channelName: string;
}

interface LocalChannelsState extends LocalChannelListing {
  error: string | null;
  loading: boolean;
}

const IDLE_LOCAL_CHANNELS: LocalChannelsState = {
  channels: [],
  connectorActive: false,
  error: null,
  loading: false,
};

const MANUAL_CHANNEL_VALUE = "__manual__";

type Action = "accept" | "reject" | "pause" | "resume" | "disconnect";

interface InstallTokenResponse {
  bridgeNpub: string;
  bridgePubkey: string;
  command: string | null;
  expiresAt: string;
  relayUrl: string;
  token: string;
}

// The install-token and activation endpoints are authorized by the single-use
// token in the body, not a NIP-98 signature, so they use a plain fetch. The
// error body is the shared `{ error: <code> }` shape errorMessage() maps.
async function postInstallerAction<T>(
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(path, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const result = (await response.json()) as T & {
    error?: string;
    message?: string;
  };
  if (!response.ok) {
    throw new Error(result.message ?? result.error ?? "Request failed.");
  }
  return result;
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
  const connectorActive = activeCommunity?.connectionState === "active";
  const localChannels = useLocalChannels(activeCommunityId, connectorActive);

  useEffect(() => {
    if (!install) return;
    if (connectorActive) {
      setInstall(null);
      setMessage("Your community is connected — the bot is admitted.");
      return;
    }
    let cancelled = false;
    let inFlight = false;
    // While the owner is admitting the bot (invite link, npub, or self-host
    // command), poll the unchanged activation round trip. It only succeeds once
    // the bridge is genuinely admitted; a refresh then flips connectorActive.
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        try {
          await postInstallerAction(
            "/api/community-connections/activate",
            { token: install.token },
          );
        } catch {
          // The bridge is not admitted yet; retry on the next tick.
        }
        const next = await signedRequest<SharedChannelAdminWorkspace>(
          "/api/shared-channels",
          "GET",
        );
        if (!cancelled) setWorkspace(next);
      } catch {
        // Transient polling failures are silently retried.
      } finally {
        inFlight = false;
      }
    };
    const interval = setInterval(tick, 4_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connectorActive, install]);

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
      setMessage("Ready — admit the bot to connect your community.");
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  // PRIMARY path: the bridge redeems a pasted invite link itself. Returns null
  // on success (the card unmounts once the refresh flips connectorActive) or a
  // plain-language error to show inline.
  async function redeemInvite(invite: string): Promise<string | null> {
    if (!install) return "This connection session is no longer available.";
    try {
      await postInstallerAction("/api/community-connections/redeem-invite", {
        invite,
        token: install.token,
      });
    } catch (error) {
      return errorMessage(error);
    }
    await refresh();
    return null;
  }

  // SECONDARY/TERTIARY paths: the owner admitted the bot out of band (npub or
  // self-host command); run the activation round trip on demand.
  async function checkBotAdded(): Promise<boolean> {
    if (!install) return false;
    try {
      await postInstallerAction("/api/community-connections/activate", {
        token: install.token,
      });
    } catch {
      return false;
    }
    await refresh();
    return true;
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
        <ClaimLookup />
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

      {install ? (
        <InstallerCommand
          install={install}
          onCheckAdded={checkBotAdded}
          onRedeem={redeemInvite}
        />
      ) : null}

      {activeCommunity?.connectionState === "active" ? (
        <ProposalForm
          activeCommunityId={activeCommunityId}
          destinations={workspace.destinations}
          localChannels={localChannels}
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
                localChannels={localChannels}
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

export function ClaimLookup() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ClaimableCandidateMatch[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(event: FormEvent) {
    event.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;
    setBusy(true);
    setError("");
    try {
      setResults(await fetchClaimableCandidates(trimmed));
    } catch {
      setError("Search failed. Try again.");
      setResults(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.claimLookup}>
      <p>
        Find the community you want to claim by its relay host or name.
      </p>
      <form className={styles.claimForm} onSubmit={search}>
        <input
          aria-label="Search communities to claim"
          onChange={(event) => setQuery(event.target.value)}
          placeholder="communities.buzz.xyz or community name"
          value={query}
        />
        <button disabled={busy || !query.trim()} type="submit">
          {busy ? "Searching..." : "Search"}
        </button>
      </form>
      {error ? <p className={styles.notice}>{error}</p> : null}
      {results && results.length > 0 ? (
        <ul className={styles.claimResults}>
          {results.map((candidate) => (
            <li key={candidate.candidateId}>
              <a href={`/claim/${candidate.candidateId}`}>
                {candidate.displayName ?? candidate.host}
              </a>
              <span>{candidate.host}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {results && results.length === 0 ? (
        <p className={styles.claimEmpty}>
          No matching unclaimed, verified community found.{" "}
          <a href="/submit">Submit it</a> to start verification.
        </p>
      ) : null}
    </div>
  );
}

export async function fetchClaimableCandidates(
  query: string,
): Promise<ClaimableCandidateMatch[]> {
  const response = await fetch(
    `/api/claimable-candidates?q=${encodeURIComponent(query)}`,
  );
  if (!response.ok) {
    throw new Error("Claimable candidate search failed.");
  }
  const data = (await response.json()) as {
    candidates: ClaimableCandidateMatch[];
  };
  return data.candidates;
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
          <strong>{connected ? "Bot connected" : "Bot not added yet"}</strong>
          <p>{community.relayUrl}</p>
        </div>
      </div>
      {connected ? (
        <span className={styles.state}>{community.connectionHealth}</span>
      ) : (
        <button disabled={busy} onClick={onConnect} type="button">
          Add the bot
        </button>
      )}
    </section>
  );
}

function InstallerCommand({
  install,
  onCheckAdded,
  onRedeem,
}: {
  install: InstallTokenResponse;
  onCheckAdded: () => Promise<boolean>;
  onRedeem: (invite: string) => Promise<string | null>;
}) {
  const [invite, setInvite] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState(false);
  const [copiedNpub, setCopiedNpub] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState(false);

  async function redeem(event: FormEvent) {
    event.preventDefault();
    const trimmed = invite.trim();
    if (!trimmed) return;
    setRedeeming(true);
    setInviteError("");
    const error = await onRedeem(trimmed);
    setRedeeming(false);
    // On success this card unmounts as the community goes active.
    if (error) setInviteError(error);
  }

  async function check() {
    setChecking(true);
    setCheckFailed(false);
    const ok = await onCheckAdded();
    setChecking(false);
    setCheckFailed(!ok);
  }

  async function copyNpub() {
    await navigator.clipboard.writeText(install.bridgeNpub);
    setCopiedNpub(true);
  }

  async function copyCommand() {
    if (!install.command) return;
    await navigator.clipboard.writeText(install.command);
    setCopiedCommand(true);
  }

  return (
    <section className={styles.botAdmission}>
      <div className={styles.botHeader}>
        <span>Connect your community</span>
        <strong>Add the BuzzRouter bot to {install.relayUrl}</strong>
        <p>
          BuzzRouter mirrors messages through a bot in your community. Admit it
          once and this page connects automatically &mdash; no key handling and
          no server access required.
        </p>
      </div>

      <form className={styles.botPrimary} onSubmit={redeem}>
        <span className={styles.botStep}>Recommended</span>
        <label>
          Paste an invite link from your Buzz app
          <input
            aria-label="Buzz invite link"
            onChange={(event) => setInvite(event.target.value)}
            placeholder="https://your-relay/invite/…"
            value={invite}
          />
        </label>
        <p className={styles.botHint}>
          In Buzz, open your community&apos;s invite and choose{" "}
          <strong>Copy link</strong>, then paste it here. The bot redeems the
          link itself and joins as a member &mdash; you never touch a key.
        </p>
        <button disabled={redeeming || !invite.trim()} type="submit">
          {redeeming ? "Connecting…" : "Add the bot with this link"}
        </button>
        {inviteError ? <p className={styles.notice}>{inviteError}</p> : null}
      </form>

      <ExpiryNotice expiresAt={install.expiresAt} />

      <details className={styles.botAlt}>
        <summary>Prefer to add a member by key?</summary>
        <p className={styles.botHint}>
          If your Buzz app offers Settings &rarr; Invites &rarr; Add member,
          paste this bridge key (npub), choose <strong>Add</strong>, then
          confirm below.
        </p>
        <div className={styles.botKeyRow}>
          <code>{install.bridgeNpub}</code>
          <button
            className={styles.secondary}
            onClick={copyNpub}
            type="button"
          >
            {copiedNpub ? "Copied" : "Copy key"}
          </button>
        </div>
        <button disabled={checking} onClick={check} type="button">
          {checking ? "Checking…" : "I’ve added the bot"}
        </button>
        {checkFailed ? (
          <p className={styles.notice}>
            We can&apos;t see the bot in your community yet. Make sure you added
            the key, then try again &mdash; we also keep checking automatically.
          </p>
        ) : null}
      </details>

      {install.command ? (
        <details className={styles.botAlt}>
          <summary>Run your own relay? Use the connector command</summary>
          <p className={styles.botHint}>
            If you self-host this community&apos;s relay, admit the bridge from
            a shell instead:
          </p>
          <div className={styles.botKeyRow}>
            <code>{install.command}</code>
            <button
              className={styles.secondary}
              onClick={copyCommand}
              type="button"
            >
              {copiedCommand ? "Copied" : "Copy command"}
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );
}

function ExpiryNotice({ expiresAt }: { expiresAt: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = new Date(expiresAt).getTime() - now;
  return (
    <p className={styles.notice}>
      {remainingMs <= 0
        ? "This connection session has expired. Refresh to start over."
        : `This bridge key is valid for ${formatDuration(remainingMs)}. Once the bot is admitted we connect automatically.`}
    </p>
  );
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function ProposalForm({
  activeCommunityId,
  destinations,
  localChannels,
  onCreated,
  setBusy,
  setMessage,
}: {
  activeCommunityId: string;
  destinations: SharedChannelCommunitySummary[];
  localChannels: LocalChannelsState;
  onCreated: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  setMessage: (message: string) => void;
}) {
  const eligible = destinations.filter(
    (community) => community.id !== activeCommunityId,
  );
  const featured = eligible.find((community) => community.featured);
  const [source, setSource] = useState<LocalChannelSelection>({
    channelId: "",
    channelName: "",
  });

  async function submit(formData: FormData) {
    setBusy(true);
    setMessage("");
    try {
      await signedRequest("/api/shared-channels", "POST", {
        destinationCommunityId: formData.get("destinationCommunityId"),
        idempotencyKey: crypto.randomUUID(),
        proposedName: formData.get("proposedName"),
        purpose: formData.get("purpose"),
        sourceChannelId: source.channelId,
        sourceChannelName: source.channelName,
        sourceCommunityId: activeCommunityId,
      });
      setSource({ channelId: "", channelName: "" });
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
        <LocalChannelPicker
          onChange={setSource}
          state={localChannels}
          value={source}
          variant="form"
        />
        <label className={styles.fullWidth}>
          Purpose
          <textarea maxLength={500} name="purpose" required rows={3} />
        </label>
      </div>
      <button
        disabled={
          eligible.length === 0 ||
          !source.channelId.trim() ||
          !source.channelName.trim()
        }
        type="submit"
      >
        Send invitation
      </button>
    </form>
  );
}

function ChannelRow({
  busy,
  channel,
  localChannels,
  onAction,
}: {
  busy: boolean;
  channel: SharedChannelAdminRecord;
  localChannels: LocalChannelsState;
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
            localChannels={localChannels}
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
  localChannels,
  onAction,
}: {
  busy: boolean;
  channel: SharedChannelAdminRecord;
  localChannels: LocalChannelsState;
  onAction: (
    channel: SharedChannelAdminRecord,
    action: Action,
    extra?: Record<string, string>,
  ) => Promise<void>;
}) {
  const [selection, setSelection] = useState<LocalChannelSelection>({
    channelId: "",
    channelName: "",
  });

  return (
    <>
      <LocalChannelPicker
        onChange={setSelection}
        state={localChannels}
        value={selection}
        variant="inline"
      />
      <button
        disabled={
          busy ||
          !selection.channelId.trim() ||
          !selection.channelName.trim()
        }
        onClick={() =>
          onAction(channel, "accept", {
            localChannelId: selection.channelId,
            localChannelName: selection.channelName,
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

function useLocalChannels(
  communityId: string,
  enabled: boolean,
): LocalChannelsState {
  const [state, setState] = useState<LocalChannelsState>(
    IDLE_LOCAL_CHANNELS,
  );

  useEffect(() => {
    if (!enabled || !communityId) {
      setState(IDLE_LOCAL_CHANNELS);
      return;
    }
    let active = true;
    setState({
      channels: [],
      connectorActive: false,
      error: null,
      loading: true,
    });
    signedRequest<LocalChannelListing>(
      `/api/shared-channels/local-channels?communityId=${encodeURIComponent(
        communityId,
      )}`,
      "GET",
    )
      .then((result) => {
        if (!active) return;
        setState({ ...result, error: null, loading: false });
      })
      .catch((error) => {
        if (!active) return;
        setState({
          channels: [],
          connectorActive: false,
          error: errorMessage(error),
          loading: false,
        });
      });
    return () => {
      active = false;
    };
  }, [communityId, enabled]);

  return state;
}

function LocalChannelPicker({
  onChange,
  state,
  value,
  variant,
}: {
  onChange: (next: LocalChannelSelection) => void;
  state: LocalChannelsState;
  value: LocalChannelSelection;
  variant: "form" | "inline";
}) {
  const { channels, connectorActive, error, loading } = state;
  const [manual, setManual] = useState(false);
  const canList = connectorActive && !error && channels.length > 0;
  const showManualFields = !loading && (!canList || manual);

  const hint = loading
    ? "Loading your channels…"
    : error
      ? "Couldn't reach your relay to list channels. Enter the channel details manually."
      : !connectorActive
        ? "Connect the Buzz connector to pick from your channels, or enter the details manually."
        : channels.length === 0
          ? "Your relay has no channels yet. Enter the details manually."
          : manual
            ? "Entering a channel your relay does not list."
            : null;

  return (
    <div
      className={
        variant === "form" ? styles.channelField : styles.channelPickerInline
      }
    >
      {variant === "form" ? (
        <span className={styles.channelFieldLabel}>Local channel</span>
      ) : null}
      {loading ? (
        <select aria-label="Local channel" disabled value="">
          <option value="">Loading your channels&hellip;</option>
        </select>
      ) : canList ? (
        <select
          aria-label="Local channel"
          onChange={(event) => {
            const next = event.target.value;
            if (next === MANUAL_CHANNEL_VALUE) {
              setManual(true);
              onChange({ channelId: "", channelName: "" });
              return;
            }
            setManual(false);
            const group = channels.find((item) => item.id === next);
            onChange({
              channelId: next,
              channelName: group?.name ?? "",
            });
          }}
          value={manual ? MANUAL_CHANNEL_VALUE : value.channelId}
        >
          <option disabled value="">
            Select a channel&hellip;
          </option>
          {channels.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
          <option value={MANUAL_CHANNEL_VALUE}>Enter manually&hellip;</option>
        </select>
      ) : null}
      {showManualFields ? (
        <>
          <input
            aria-label="Local channel ID"
            maxLength={200}
            onChange={(event) =>
              onChange({ ...value, channelId: event.target.value })
            }
            placeholder="Channel ID"
            value={value.channelId}
          />
          <input
            aria-label="Local channel name"
            maxLength={80}
            onChange={(event) =>
              onChange({ ...value, channelName: event.target.value })
            }
            placeholder="Channel name"
            value={value.channelName}
          />
        </>
      ) : null}
      {hint ? (
        <p
          className={
            variant === "form"
              ? styles.channelHint
              : styles.channelHintInline
          }
        >
          {hint}
        </p>
      ) : null}
    </div>
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

function shortKey(pubkey: string): string {
  return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`;
}
