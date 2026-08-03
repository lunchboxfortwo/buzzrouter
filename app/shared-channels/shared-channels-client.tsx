"use client";

import {
  type FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { LocalChannelListing } from "../../src/shared-channels/local-channels";
import type { HubMembership } from "../../src/shared-channels/store";

import { errorMessage } from "./error-message";
import styles from "./shared-channels.module.css";

interface LocalChannelSelection {
  mode: "create" | "existing";
  channelId: string;
  channelName: string;
}

type OwnerRequest = <T>(
  path: string,
  method: "GET" | "POST" | "PATCH",
  body?: Record<string, unknown>,
) => Promise<T>;

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

interface BeginFromInviteResponse {
  communityId: string;
  displayName: string;
  expiresAt: string;
  relayUrl: string;
  session: string;
}

// The invite itself is the owner-level authorization. This short-lived session
// is scoped to that community and only controls its hub endpoint.
async function sessionRequest<T>(
  path: string,
  method: "GET" | "POST" | "PATCH",
  session: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(path, {
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    headers: {
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      "x-owner-session": session,
    },
    method,
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

/**
 * The whole page. A phone can paste an invite link, connect, and manage routes
 * through the short-lived owner session minted by that admission.
 */
export function SharedChannelsClient() {
  return <SignerFreeLink />;
}

function SignerFreeLink() {
  const [invite, setInvite] = useState("");
  const [admitting, setAdmitting] = useState(false);
  const [error, setError] = useState("");
  const [community, setCommunity] = useState<BeginFromInviteResponse | null>(
    null,
  );
  const [selection, setSelection] = useState<LocalChannelSelection>({
    channelId: "",
    channelName: "",
    mode: "existing",
  });
  const [connecting, setConnecting] = useState(false);
  const [membership, setMembership] = useState<HubMembership | null>(null);
  const request = useMemo<OwnerRequest>(
    () => (path, method, body) => {
      if (!community) return Promise.reject(new Error("Invite session unavailable."));
      return sessionRequest(path, method, community.session, body);
    },
    [community],
  );
  const localChannels = useLocalChannels(
    community?.communityId ?? "",
    Boolean(community),
    request,
    true,
  );

  async function admit(event: FormEvent) {
    event.preventDefault();
    const trimmed = invite.trim();
    if (!trimmed) return;
    setAdmitting(true);
    setError("");
    try {
      const result = await postInstallerAction<BeginFromInviteResponse>(
        "/api/community-connections/begin-from-invite",
        { invite: trimmed },
      );
      setCommunity(result);
      setInvite("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAdmitting(false);
    }
  }

  async function connectHub() {
    if (!community) return;
    setConnecting(true);
    setError("");
    try {
      const result = await sessionRequest<HubMembership>(
        "/api/shared-channels/hub",
        "POST",
        community.session,
        {
          localChannelId: selection.channelId.trim(),
          localChannelName: selection.channelName.trim(),
        },
      );
      setMembership(result);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setConnecting(false);
    }
  }

  if (community && membership) {
    return (
      <>
        <section className={styles.linkCard}>
          <h2>{community.displayName} is in the open channel</h2>
          <p className={styles.linkLead}>
            Messages from other communities in the hub will appear in{" "}
            <strong>#{membership.localChannelName}</strong>. Messages your
            community sends there can reach every hub member that accepts them.
          </p>
          <HubSettings
            membership={membership}
            onChange={setMembership}
            request={request}
          />
        </section>
      </>
    );
  }

  if (community) {
    return (
      <>
        <section className={styles.linkCard}>
          <h2>Connected: {community.displayName}</h2>
          <p className={styles.linkLead}>
            Pick the channel that will carry hub traffic. Messages from other
            communities in the hub will appear in this channel.
          </p>
          <HubChannelPicker
            onChange={setSelection}
            state={localChannels}
            value={selection}
          />
          <button
            className={styles.primaryCta}
            disabled={
              connecting ||
              !localChannels.connectorActive ||
              !selection.channelId.trim() ||
              !selection.channelName.trim()
            }
            onClick={connectHub}
            type="button"
          >
            {connecting ? "Joining…" : "Join the open BuzzRouter channel"}
          </button>
          {error ? <p className={styles.notice}>{error}</p> : null}
        </section>
      </>
    );
  }

  return (
    <section className={styles.linkCard} id="invite-link">
      <form onSubmit={admit}>
        <label>
          Your Buzz invite link
          <input
            aria-label="Invite link from your Buzz app"
            onChange={(event) => setInvite(event.target.value)}
            placeholder="https://your-relay/invite/…"
            value={invite}
          />
        </label>
        <p className={styles.linkNote}>
          Open your community&apos;s invite in Buzz, tap <strong>Copy
          link</strong>, and paste it here. No browser extension needed &mdash;
          works on your phone.
        </p>
        <p className={styles.consentNote}>
          Linking turns sending and receiving on. Messages from other
          communities in the hub will appear in the channel you choose next.
        </p>
        <button
          className={styles.primaryCta}
          disabled={admitting || !invite.trim()}
          type="submit"
        >
          {admitting ? "Connecting…" : "Add your community"}
        </button>
      </form>
      {error ? <p className={styles.notice}>{error}</p> : null}
    </section>
  );
}

function HubChannelPicker({
  onChange,
  state,
  value,
}: {
  onChange: (selection: LocalChannelSelection) => void;
  state: LocalChannelsState;
  value: LocalChannelSelection;
}) {
  if (state.loading || !state.connectorActive) {
    return (
      <div className={styles.connectorWait} role="status">
        <span aria-hidden="true" className={styles.spinner} />
        <div>
          <strong>Waiting for the bridge to come online</strong>
          <p>
            Your invite was accepted. The connector is signing in to your relay
            so BuzzRouter can list the channels you already have.
          </p>
        </div>
      </div>
    );
  }
  if (state.error) return <p className={styles.notice}>{state.error}</p>;
  if (state.channels.length === 0) {
    return <p className={styles.notice}>Your relay did not return any channels.</p>;
  }
  return (
    <label>
      Channel for hub messages
      <select
        aria-label="Channel for hub messages"
        onChange={(event) => {
          const channel = state.channels.find(
            (item) => item.id === event.target.value,
          );
          onChange({
            channelId: channel?.id ?? "",
            channelName: channel?.name ?? "",
            mode: "existing",
          });
        }}
        value={value.channelId}
      >
        <option value="">Choose a channel…</option>
        {state.channels.map((channel) => (
          <option key={channel.id} value={channel.id}>
            {channel.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function HubSettings({
  membership,
  onChange,
  request,
}: {
  membership: HubMembership;
  onChange: (membership: HubMembership) => void;
  request: OwnerRequest;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await request<HubMembership>(
          "/api/shared-channels/hub",
          "GET",
        );
        if (active) onChange(next);
      } catch {
        // A short-lived owner session can expire while this page is open. The
        // next explicit settings action surfaces that error with recovery copy.
      }
    };
    const timer = setInterval(() => void refresh(), 5_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [onChange, request]);

  async function save(next: Partial<HubMembership>) {
    setSaving(true);
    setError("");
    try {
      onChange(
        await request<HubMembership>("/api/shared-channels/hub", "PATCH", {
          filterList: next.filterList ?? membership.filterList,
          filterMode: next.filterMode ?? membership.filterMode,
          receives: next.receives ?? membership.receives,
          sends: next.sends ?? membership.sends,
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div aria-busy={saving} className={styles.hubSettings}>
      <div className={styles.switches}>
        <label>
          <input
            checked={membership.sends}
            disabled={saving}
            onChange={(event) => void save({ sends: event.target.checked })}
            type="checkbox"
          />
          Send messages to the hub
        </label>
        <label>
          <input
            checked={membership.receives}
            disabled={saving}
            onChange={(event) => void save({ receives: event.target.checked })}
            type="checkbox"
          />
          Receive messages from the hub
        </label>
      </div>
      <fieldset disabled={saving}>
        <legend>Communities this channel connects with</legend>
        <select
          aria-label="Community filter mode"
          onChange={(event) =>
            void save({
              filterMode: event.target.value as HubMembership["filterMode"],
            })
          }
          value={membership.filterMode}
        >
          <option value="everyone_except">Everyone except</option>
          <option value="only_these">Only these communities</option>
        </select>
        <div className={styles.communityFilterList}>
          {membership.members.map((member) => (
            <label key={member.communityId}>
              <input
                checked={membership.filterList.includes(member.communityId)}
                onChange={(event) =>
                  void save({
                    filterList: event.target.checked
                      ? [...membership.filterList, member.communityId]
                      : membership.filterList.filter(
                          (id) => id !== member.communityId,
                        ),
                  })
                }
                type="checkbox"
              />
              {member.displayName}
            </label>
          ))}
          {membership.members.length === 0 ? (
            <p>You are the first linked community.</p>
          ) : null}
        </div>
      </fieldset>
      <div className={styles.deliveryOutcomes}>
        <h3>Recent delivery outcomes</h3>
        {membership.recentOutcomes.length === 0 ? (
          <p>No hub messages sent yet.</p>
        ) : (
          <ul>
            {membership.recentOutcomes.map((outcome) => (
              <li key={`${outcome.messageId}:${outcome.communityId}`}>
                <span>{outcome.communityName}</span>
                <strong>{deliveryOutcomeLabel(outcome.state)}</strong>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.linkNote}>
          Delivered means the destination relay acknowledged the message.
          Queued work is never labeled sent.
        </p>
      </div>
      {error ? <p className={styles.notice}>{error}</p> : null}
    </div>
  );
}

function deliveryOutcomeLabel(
  state: HubMembership["recentOutcomes"][number]["state"],
): string {
  if (state === "delivered_to_relay") return "Delivered";
  if (state === "failed") return "Failed";
  if (state === "cancelled") return "Cancelled";
  if (state === "retry") return "Retrying";
  if (state === "delivering") return "Delivering";
  return "Queued";
}

function useLocalChannels(
  communityId: string,
  enabled: boolean,
  request: OwnerRequest,
  pollUntilActive = false,
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
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const result = await request<LocalChannelListing>(
          `/api/shared-channels/local-channels?communityId=${encodeURIComponent(
            communityId,
          )}`,
          "GET",
        );
        if (!active) return;
        setState({
          ...result,
          error: null,
          loading: pollUntilActive && !result.connectorActive,
        });
        if (pollUntilActive && !result.connectorActive) {
          timer = setTimeout(load, 2_000);
        }
      } catch (error) {
        if (!active) return;
        setState({
          channels: [],
          connectorActive: false,
          error: errorMessage(error),
          loading: false,
        });
      }
    };
    void load();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [communityId, enabled, pollUntilActive, request]);

  return state;
}
