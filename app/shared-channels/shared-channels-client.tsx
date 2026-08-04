"use client";

import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
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

/**
 * Read a response body that is *supposed* to be our JSON error shape but may
 * not be.
 *
 * Nothing between the browser and the route is obliged to speak JSON: when a
 * request outlives the Cloudflare edge timeout the browser gets Cloudflare's
 * HTML error page, and an unguarded `response.json()` then throws
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` — burying the real
 * failure under a parser complaint. Fall back to naming the actual HTTP status
 * so the user sees the problem instead of the symptom.
 */
async function readJsonResponse<T>(
  response: Response,
): Promise<T & { error?: string; message?: string }> {
  const body = await response.text();
  try {
    return JSON.parse(body) as T & { error?: string; message?: string };
  } catch {
    if (response.ok) {
      throw new Error(
        `The server returned an unreadable response (HTTP ${response.status}).`,
      );
    }
    throw new Error(
      response.status === 504 || response.status === 524
        ? "The relay did not answer in time, so the request was cut off before it finished. Nothing was changed — try again."
        : `The server returned an error (HTTP ${response.status}).`,
    );
  }
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
  const result = await readJsonResponse<T>(response);
  if (!response.ok) {
    throw new Error(result.message ?? result.error ?? "Request failed.");
  }
  return result;
}

interface BeginFromInviteResponse {
  communityId: string;
  displayName: string;
  expiresAt: string;
  reentered: boolean;
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
  const result = await readJsonResponse<T>(response);
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
  return <SignerFreeConnect />;
}

function SignerFreeConnect() {
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
      let existingMembership: HubMembership | null = null;
      if (result.reentered) {
        try {
          existingMembership = await sessionRequest<HubMembership>(
            "/api/shared-channels/hub",
            "GET",
            result.session,
          );
        } catch (caught) {
          if (
            !(caught instanceof Error) ||
            caught.message !== "hub_membership_not_found"
          ) {
            throw caught;
          }
        }
      }
      setCommunity(result);
      setMembership(existingMembership);
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

  async function createAndConnectHub(
    channelName: string,
    idempotencyKey: string,
  ) {
    if (!community) return;
    setConnecting(true);
    setError("");
    try {
      const channel = await sessionRequest<{
        channelId: string;
        channelName: string;
      }>(
        "/api/shared-channels/create-channel",
        "POST",
        community.session,
        { channelName, idempotencyKey },
      );
      setMembership(
        await sessionRequest<HubMembership>(
          "/api/shared-channels/hub",
          "POST",
          community.session,
          {
            localChannelId: channel.channelId,
            localChannelName: channel.channelName,
          },
        ),
      );
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
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
            busy={connecting}
            onCreate={createAndConnectHub}
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
            {connecting ? "Connecting…" : "Connect channel to hub"}
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
          Connecting turns sending and receiving on. Messages from other
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
  busy,
  onCreate,
  onChange,
  state,
  value,
}: {
  busy: boolean;
  onCreate: (channelName: string, idempotencyKey: string) => Promise<void>;
  onChange: (selection: LocalChannelSelection) => void;
  state: LocalChannelsState;
  value: LocalChannelSelection;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value.channelName);
  const [activeIndex, setActiveIndex] = useState(-1);
  const idempotencyKeys = useRef(new Map<string, string>());
  const filteredChannels = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return state.channels;
    return state.channels.filter((channel) =>
      `${channel.name} ${channel.id}`.toLocaleLowerCase().includes(needle),
    );
  }, [query, state.channels]);
  const createName = query.trim().replace(/^#+/, "").trim();
  const canCreate =
    createName.length > 0 &&
    createName.length <= 80 &&
    filteredChannels.length === 0;

  useEffect(() => {
    setQuery(value.channelName);
  }, [value.channelId, value.channelName]);

  function choose(channel: LocalChannelListing["channels"][number]) {
    setQuery(channel.name);
    setOpen(false);
    setActiveIndex(-1);
    onChange({
      channelId: channel.id,
      channelName: channel.name,
      mode: "existing",
    });
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      if (filteredChannels.length === 0) return;
      setActiveIndex((current) => {
        if (event.key === "ArrowDown") {
          return current >= filteredChannels.length - 1 ? 0 : current + 1;
        }
        return current <= 0 ? filteredChannels.length - 1 : current - 1;
      });
      return;
    }
    if (
      event.key === "Enter" &&
      activeIndex >= 0 &&
      filteredChannels[activeIndex]
    ) {
      event.preventDefault();
      choose(filteredChannels[activeIndex]);
    }
  }

  async function createChannel() {
    if (!canCreate || busy) return;
    let idempotencyKey = idempotencyKeys.current.get(createName);
    if (!idempotencyKey) {
      idempotencyKey = `channel-${crypto.randomUUID()}`;
      idempotencyKeys.current.set(createName, idempotencyKey);
    }
    try {
      await onCreate(createName, idempotencyKey);
      setOpen(false);
    } catch {
      // The owning surface renders the product error. Keep this exact name and
      // key in place so the explicit retry resumes an incomplete handoff.
    }
  }

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
  return (
    <div className={styles.channelCombobox}>
      <label htmlFor="hub-channel-combobox">Channel for hub messages</label>
      <div
        className={styles.comboboxControl}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
            setActiveIndex(-1);
          }
        }}
      >
        <input
        aria-autocomplete="list"
        aria-controls="hub-channel-options"
        aria-expanded={open}
        aria-label="Channel for hub messages"
        autoComplete="off"
        id="hub-channel-combobox"
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(-1);
          onChange({
            channelId: "",
            channelName: event.target.value,
            mode: "create",
          });
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search or name a channel…"
        role="combobox"
        value={query}
        />
        {open ? (
          <div className={styles.comboboxMenu} id="hub-channel-options">
            {filteredChannels.length > 0 ? (
              <div className={styles.comboboxOptions} role="listbox">
                {filteredChannels.map((channel, index) => (
                  <button
                    aria-selected={index === activeIndex}
                    className={styles.comboboxOption}
                    key={channel.id}
                    onClick={() => choose(channel)}
                    onMouseDown={(event) => event.preventDefault()}
                    role="option"
                    type="button"
                  >
                    <span>#{channel.name}</span>
                    <small>{channel.id}</small>
                  </button>
                ))}
              </div>
            ) : canCreate ? (
              <div className={styles.createChannelOffer}>
                <button
                  disabled={busy}
                  onClick={() => void createChannel()}
                  type="button"
                >
                  {busy ? "Creating…" : `Create #${createName}`}
                </button>
                <p>
                  Creates this channel in your community, transfers ownership
                  to you, and connects it to the hub.
                </p>
              </div>
            ) : (
              <p className={styles.comboboxEmpty}>
                Type a channel name to create one.
              </p>
            )}
          </div>
        ) : null}
      </div>
      <p className={styles.channelPickerNote}>
        Choose an existing channel, or type a new name and use the explicit
        create action.
      </p>
    </div>
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
  const [channelSelection, setChannelSelection] =
    useState<LocalChannelSelection>({
      channelId: membership.localChannelId,
      channelName: membership.localChannelName,
      mode: "existing",
    });
  const localChannels = useLocalChannels(
    membership.communityId,
    true,
    request,
  );

  useEffect(() => {
    setChannelSelection({
      channelId: membership.localChannelId,
      channelName: membership.localChannelName,
      mode: "existing",
    });
  }, [membership.localChannelId, membership.localChannelName]);

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

  async function update(next: Partial<HubMembership>) {
    return request<HubMembership>("/api/shared-channels/hub", "PATCH", {
      filterList: next.filterList ?? membership.filterList,
      filterMode: next.filterMode ?? membership.filterMode,
      ...(next.localChannelId && next.localChannelName
        ? {
            localChannelId: next.localChannelId,
            localChannelName: next.localChannelName,
          }
        : {}),
      receives: next.receives ?? membership.receives,
      sends: next.sends ?? membership.sends,
    });
  }

  async function save(next: Partial<HubMembership>) {
    setSaving(true);
    setError("");
    try {
      onChange(await update(next));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSaving(false);
    }
  }

  async function createAndChangeChannel(
    channelName: string,
    idempotencyKey: string,
  ) {
    setSaving(true);
    setError("");
    try {
      const channel = await request<{
        channelId: string;
        channelName: string;
      }>("/api/shared-channels/create-channel", "POST", {
        channelName,
        idempotencyKey,
      });
      onChange(
        await update({
          localChannelId: channel.channelId,
          localChannelName: channel.channelName,
        }),
      );
    } catch (caught) {
      setError(errorMessage(caught));
      throw caught;
    } finally {
      setSaving(false);
    }
  }

  return (
    <div aria-busy={saving} className={styles.hubSettings}>
      <div className={styles.channelSetting}>
        <HubChannelPicker
          busy={saving}
          onChange={setChannelSelection}
          onCreate={createAndChangeChannel}
          state={localChannels}
          value={channelSelection}
        />
        <button
          className={styles.secondary}
          disabled={
            saving ||
            !channelSelection.channelId ||
            channelSelection.channelId === membership.localChannelId
          }
          onClick={() =>
            void save({
              localChannelId: channelSelection.channelId,
              localChannelName: channelSelection.channelName,
            })
          }
          type="button"
        >
          Change hub channel
        </button>
      </div>
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
            <p>You are the first connected community.</p>
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
