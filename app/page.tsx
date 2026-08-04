
import Image from "next/image";

import { listDirectoryCommunities, type DirectoryCommunity } from "../src/db/directory";
import { getDatabasePool } from "../src/db/pool";
import {
  reliabilityLabel,
  type ReliabilityFacts,
} from "../src/ranking/explain";
import { focusLabel } from "../src/ranking/focus";

import { AutoSubmitCheckbox } from "./AutoSubmitCheckbox";
import { AutoSubmitSelect } from "./AutoSubmitSelect";
import { AddInviteCta } from "./AddInviteCta";
import { CommunityRowLink } from "./CommunityRowLink";
import { RowJoinButton } from "./RowJoinButton";
import { JoinButton } from "./JoinButton";
import { accessFlag, joinAffordance } from "./joinability-view";
import { MobileCollapsible } from "./MobileCollapsible";
import { ShareOnX } from "./ShareOnX";
import styles from "./directory.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


interface Filters {
  focus: string;
  joinable: string;
  q: string;
}

interface PageSearchParams {
  focus?: string | string[];
  joinable?: string | string[];
  q?: string | string[];
  selected?: string | string[];
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  const search = firstValue(params.q).trim().slice(0, 100);
  const focusFilter = firstValue(params.focus).trim();
  const joinableOnly = firstValue(params.joinable) === "1";
  const filters: Filters = {
    focus: focusFilter,
    joinable: joinableOnly ? "1" : "",
    q: search,
  };

  const allCommunities = await listDirectoryCommunities(getDatabasePool(), {
    search,
  });

  const focusOptions = Array.from(
    new Set(
      allCommunities.flatMap((community) =>
        community.focus ? [community.focus] : [],
      ),
    ),
  ).sort((a, b) => focusLabel(a).localeCompare(focusLabel(b)));

  const communities = allCommunities.filter((community) => {
    if (focusFilter && community.focus !== focusFilter) return false;
    if (joinableOnly && joinAffordance(community) !== "join") return false;
    return true;
  });

  const selectedId = firstValue(params.selected);
  const selected =
    communities.find((community) => community.candidateId === selectedId) ??
    communities[0];
  const filtersApplied = Boolean(search || focusFilter || joinableOnly);

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#directory">
        Skip to directory
      </a>

      <form
        action="/"
        className={styles.formShell}
        id="directory-filters"
        method="GET"
      >
        {selected ? (
          <input name="selected" type="hidden" value={selected.candidateId} />
        ) : null}
      </form>

      <main id="directory">
          <div className={styles.workspaceShell}>
            <header className={styles.premiseBand}>
              <div>
                <h1 className={styles.premiseHeading}>
                  <span className={styles.headingLine}>Find a Buzz community</span>
                  <em className={styles.premiseMark}>
                    worth joining.
                    <svg
                      aria-hidden="true"
                      className={styles.premiseUnderline}
                      preserveAspectRatio="none"
                      viewBox="0 0 220 12"
                    >
                      <path d="M4 9 C 60 3.5, 150 2.5, 216 6.5" pathLength="1" />
                    </svg>
                  </em>
                </h1>
                <p className={styles.premiseSub}>
                  BuzzRouter connects Buzz communities so their channels can
                  talk to each other. Every listing here is checked at the relay
                  itself.
                </p>
              </div>
              <svg
                aria-hidden="true"
                className={styles.premiseSignal}
                viewBox="0 0 340 140"
              >
                <path className={styles.routeLine} d="M60 74 C 130 28, 214 28, 282 64" />
                <path
                  className={styles.routePulse}
                  d="M60 74 C 130 28, 214 28, 282 64"
                  pathLength="100"
                />
                <circle
                  className={`${styles.signalRing} ${styles.signalRingLate}`}
                  cx="60"
                  cy="74"
                  r="15"
                />
                <circle className={styles.signalRing} cx="60" cy="74" r="15" />
                <circle className={styles.signalOrigin} cx="60" cy="74" r="7" />
                <circle className={styles.signalRelay} cx="282" cy="64" r="15" />
                <path className={styles.signalCheck} d="m276 64 4.5 4.5 8.5-9.5" />
                <text className={styles.signalLabel} textAnchor="middle" x="60" y="112">
                  BuzzRouter
                </text>
                <text className={styles.signalLabel} textAnchor="middle" x="282" y="104">
                  verified
                </text>
                <text
                  className={`${styles.signalLabel} ${styles.signalLabelRoute}`}
                  textAnchor="middle"
                  x="172"
                  y="18"
                >
                  checked directly
                </text>
              </svg>
            </header>

            <section aria-label="Filter communities" className={styles.commandBar}>
              <label className={styles.commandFilter}>
                <span>Focus</span>
                <AutoSubmitSelect form="directory-filters" name="focus">
                  <option value="">Any focus</option>
                  {focusOptions.map((focus) => (
                    <option key={focus} value={focus}>
                      {focusLabel(focus)}
                    </option>
                  ))}
                </AutoSubmitSelect>
              </label>
              <label
                className={styles.commandToggle}
                title="Communities you can join right now"
              >
                <AutoSubmitCheckbox
                  form="directory-filters"
                  name="joinable"
                  value="1"
                />
                <span>Joinable</span>
              </label>
              <noscript>
                <button
                  className={styles.applyButton}
                  form="directory-filters"
                  type="submit"
                >
                  Apply
                </button>
              </noscript>
              <span className={styles.resultCount}>
                <strong>{communities.length}</strong>{" "}
                {communities.length === 1 ? "result" : "results"}
              </span>
            </section>

            <div className={styles.workspaceGrid}>
              <section
                aria-labelledby="directory-results-title"
                className={styles.communityIndex}
              >
                <div aria-hidden="true" className={styles.indexHeader}>
                  <span>Community</span>
                  <span>Focus</span>
                  <span />
                </div>
                <h2 className={styles.visuallyHidden} id="directory-results-title">
                  Community results
                </h2>

                {communities.length > 0 && selected ? (
                  <ul className={styles.indexList}>
                    {communities.map((community) => (
                      <li key={community.candidateId}>
                        <CommunityRow
                          community={community}
                          filters={filters}
                          selected={community.candidateId === selected.candidateId}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className={styles.emptyIndex}>
                    <h2>
                      {filtersApplied ? "No communities match these filters" : "Index warming up"}
                    </h2>
                    <p>
                      {filtersApplied
                        ? "Try a relay host, a broader name, or clear a filter."
                        : "Verified communities appear here once a relay passes BuzzRouter's checks."}
                    </p>
                    {filtersApplied ? <a href="/">Clear filters</a> : null}
                  </div>
                )}

                <footer className={styles.indexFooter}>
                  <span>
                    {communities.length === allCommunities.length
                      ? `${allCommunities.length} verified ${allCommunities.length === 1 ? "community" : "communities"}`
                      : `${communities.length} of ${allCommunities.length} verified communities shown`}
                  </span>
                  <span>Connected marks current hub participants.</span>
                </footer>
              </section>

              {selected ? (
                <CommunityInspector community={selected} />
              ) : (
                <aside aria-label="Community inspector" className={styles.inspectorPlaceholder}>
                  <p>Select a community to inspect its signal here.</p>
                </aside>
              )}
            </div>


          </div>
        </main>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <div>
            <a aria-label="BuzzRouter directory" className={styles.footerBrand} href="/">
              <Image
                alt=""
                className={styles.footerLogo}
                height={28}
                src="/assets/brand/buzzrouter-logo.png"
                width={28}
              />
              <span>BuzzRouter</span>
            </a>
            <p>
              Discover and compare communities built on Buzz, then join through each
              community&rsquo;s own space.
            </p>
          </div>
          <div className={styles.footerMethod}>
            <h2>How ranking works</h2>
            <p>
              Activity is observed directly at each relay, thin evidence is
              discounted, and popularity is never a substitute for quality.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

function CommunityRow({
  community,
  filters,
  selected,
}: {
  community: DirectoryCommunity;
  filters: Filters;
  selected: boolean;
}) {
  const tone = insigniaTone(community.relayHost);
  const affordance = joinAffordance(community);

  return (
    <div
      aria-current={selected ? "true" : undefined}
      className={styles.indexRow}
    >
      <CommunityRowLink
        ariaLabel={`View ${community.displayName}`}
        className={styles.indexRowLink}
        href={buildHref(filters, { selected: community.candidateId })}
      />
      <span className={styles.indexCommunityCell}>
        {community.iconUrl ? (
          <Image
            alt=""
            className={styles.indexInsignia}
            height={48}
            src={community.iconUrl}
            unoptimized
            width={48}
          />
        ) : (
          <span aria-hidden="true" className={styles.indexInsignia} style={tone}>
            {monogram(community.displayName)}
          </span>
        )}
        <span className={styles.indexCommunityCopy}>
          <span className={styles.indexNameLine}>
            <strong className={styles.indexName}>{community.displayName}</strong>
            {accessFlag(community) === "open" ? (
              <span className={`${styles.accessFlag} ${styles.accessFlagOpen}`}>
                Open to join
              </span>
            ) : accessFlag(community) === "invite" ? (
              <span className={`${styles.accessFlag} ${styles.accessFlagInvite}`}>
                Invite-only
              </span>
            ) : null}
          </span>
          {community.connectedToHub || community.tagline ? (
            <span className={styles.indexSecondaryLine}>
              {community.connectedToHub ? (
                <span
                  aria-label="Connected to BuzzRouter hub"
                  className={styles.connectionMarker}
                >
                  <span aria-hidden="true" className={styles.connectionMarkerDot} />
                  Connected
                </span>
              ) : null}
              {community.tagline ? (
                <small className={styles.indexSummary}>{community.tagline}</small>
              ) : null}
            </span>
          ) : null}
        </span>
      </span>
      <span className={styles.indexFocusCell}>
        {community.focus ? focusLabel(community.focus) : null}
      </span>
      <span className={styles.indexRowTrailing}>
        {affordance === "join" ? (
          <RowJoinButton
            className={styles.indexRowJoin}
            communityName={community.displayName}
            joinTarget={{
              candidateId: community.candidateId,
              inviteCode: community.inviteCode,
              publicUrl: community.publicUrl,
              relayUrl: community.canonicalRelayUrl,
            }}
          />
        ) : affordance === "request-invite" ? (
          <span className={styles.indexRowRequest}>Request invite</span>
        ) : (
          <svg
            aria-hidden="true"
            className={styles.indexRowArrow}
            viewBox="0 0 24 24"
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
      </span>
    </div>
  );
}

function CommunityInspector({ community }: { community: DirectoryCommunity }) {
  const facts = toReliabilityFacts(community);
  const label = reliabilityLabel(facts);
  const statusClass = reliabilityStatusClass(label);
  const tone = insigniaTone(community.relayHost);
  const hasActivity = hasActivitySummary(community);
  const keyless = !community.inviteCode && !community.publicUrl;
  const overview = summaryLine(community);
  const shareUrl = `${process.env.PUBLIC_APP_ORIGIN ?? "https://buzzrouter.com"}/communities/${encodeURIComponent(community.relayHost)}`;
  const shareText = `${community.displayName} — a real, live Buzz community, verified by @buzzrouter`;

  return (
    <article
      aria-labelledby="inspector-title"
      className={styles.communityInspector}
      id="community-card"
    >
      <header className={styles.inspectorHeader}>
        <div className={styles.inspectorHeading}>
          <span aria-hidden="true" className={styles.inspectorInsignia} style={tone}>
            {monogram(community.displayName)}
          </span>
          <div>
            <div className={styles.inspectorNameRow}>
              <h2 className={styles.inspectorTitle} id="inspector-title">
                {community.displayName}
              </h2>
              <a
                className={styles.inspectorProfileInline}
                href={`/communities/${encodeURIComponent(community.relayHost)}`}
              >
                Full profile
                <svg aria-hidden="true" viewBox="0 0 24 24">
                  <path d="M5 12h14M13 6l6 6-6 6" />
                </svg>
              </a>
            </div>
            {community.tagline ?? overview ? (
              <p className={styles.inspectorSummary}>
                {community.tagline ?? overview}
              </p>
            ) : null}
          </div>
        </div>
        <div className={styles.inspectorStatus}>
          <span className={`${styles.indexStatusCell} ${statusClass}`}>
            <span aria-hidden="true" className={styles.statusDot} />
            {label}
          </span>
          <span>Checked {relativeTime(community.lastVerifiedAt)}</span>
          <span
            className={`${styles.connectionMarker} ${
              community.connectedToHub ? "" : styles.connectionMarkerInactive
            }`}
          >
            <span aria-hidden="true" className={styles.connectionMarkerDot} />
            {community.connectedToHub ? "Connected to hub" : "Not connected to hub"}
          </span>
          {accessFlag(community) === "open" ? (
            <span className={`${styles.accessFlag} ${styles.accessFlagOpen}`}>
              Open to join
            </span>
          ) : accessFlag(community) === "invite" ? (
            <span className={`${styles.accessFlag} ${styles.accessFlagInvite}`}>
              Invite-only
            </span>
          ) : null}
          <ShareOnX
            className={styles.inspectorShare}
            label="Share"
            text={shareText}
            url={shareUrl}
          />
        </div>
        <JoinButton
          candidateId={community.candidateId}
          className={keyless ? styles.copyButtonQuiet : styles.copyButton}
          communityName={community.displayName}
          inviteCode={community.inviteCode}
          joinStatus={community.joinStatus}
          publicUrl={community.publicUrl}
          relayUrl={community.canonicalRelayUrl}
        />
      </header>

      <MobileCollapsible label="More detail">
      {hasActivity ? (
        <dl className={`${styles.inspectorMetrics} ${styles.inspectorActivity}`}>
          <div className={styles.metricTile}>
            <dt>Activity</dt>
            <dd>
              {activityLabel(community.activityLevel)}
              <span className={styles.metricNote}>
                past {community.activityWindowDays ?? 7}d
              </span>
            </dd>
          </div>
          <div className={styles.metricTile}>
            <dt>Active members</dt>
            <dd>
              {community.activeMemberCount}
              <span className={styles.metricNote}>
                {community.totalMemberCount
                  ? `of ${community.totalMemberCount} members`
                  : "active recently"}
              </span>
            </dd>
          </div>
          <div className={styles.metricTile}>
            <dt>Messages</dt>
            <dd>
              {community.messageCount}
              <span className={styles.metricNote}>
                past {community.activityWindowDays ?? 7}d
              </span>
            </dd>
          </div>
        </dl>
      ) : null}

      {community.categories.length > 0 ? (
        <div className={styles.inspectorTags}>
          <span>Categories</span>
          <div className={styles.tagList}>
            {community.categories.map((category) => (
              <span className={styles.tag} key={category}>
                {category}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {hasActivity ? (
        (community.tagline && overview) ||
        community.recentProjects.length > 0 ? (
          <div className={styles.inspectorSections}>
            {community.tagline && overview ? (
              <section className={styles.inspectorSection}>
                <h3>Overview</h3>
                <p>{overview}</p>
                <small>What this community is about.</small>
              </section>
            ) : null}
            {community.recentProjects.length > 0 ? (
              <section className={styles.inspectorSection}>
                <h3>Recently</h3>
                <ul className={styles.reasonList}>
                  {community.recentProjects.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <small>
                  What the community has been working on lately, from our agent
                  inside it.
                </small>
              </section>
            ) : null}
          </div>
        ) : null
      ) : (
        <p className={styles.inspectorNote}>
          Verified live at the relay &mdash; but we don&rsquo;t have an agent
          inside yet, so there&rsquo;s no activity to show.
        </p>
      )}
      </MobileCollapsible>

      {keyless ? (
        <div className={styles.inspectorInviteCta}>
          <AddInviteCta host={community.relayHost} variant="quiet" />
        </div>
      ) : null}

      <footer className={styles.inspectorFooter}>
        <a href={`/communities/${encodeURIComponent(community.relayHost)}`}>
          View full profile
        </a>
      </footer>
    </article>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}



/**
 * A short, community-specific line for a directory row — what THIS community is
 * about, not its relay URL. Every listing is a Buzz community, so the generic
 * relay boilerplate ("Buzz", "private team communication relay") says nothing
 * that distinguishes it; in that case we return null and the row simply omits
 * the line rather than showing filler. The description is clamped to one line
 * by CSS (`.indexSummary`).
 */
const GENERIC_SUMMARY =
  /^\s*(a\s+)?buzz(\s+(relay|community|workspace))?\.?\s*$|private team communication relay/i;

function summaryLine(community: DirectoryCommunity): string | null {
  const text = community.description?.trim();
  if (!text || GENERIC_SUMMARY.test(text)) return null;
  return text;
}

const ACTIVITY_LABEL: Record<string, string> = {
  quiet: "Quiet",
  light: "Light",
  active: "Active",
  busy: "Busy",
};

function activityLabel(level: string | null): string {
  return (level && ACTIVITY_LABEL[level]) || "Active";
}

/**
 * True when the in-community agent has summarized this community, so the
 * inspector can show live activity (members, messages, pace) instead of the
 * relay-probe metrics. Both fields are written together by the summary job.
 */
function hasActivitySummary(community: DirectoryCommunity): boolean {
  return (
    community.lastSummarizedAt !== null && community.activeMemberCount !== null
  );
}

function monogram(displayName: string): string {
  return displayName.trim().slice(0, 1).toUpperCase() || "B";
}

/**
 * Deterministic per-host tint so a community's monogram tile stays visually
 * stable across renders without needing per-community artwork.
 */
function insigniaTone(host: string): { background: string; color: string } {
  let hash = 0;
  for (let index = 0; index < host.length; index += 1) {
    hash = (hash * 31 + host.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return {
    background: `hsl(${hue} 68% 93%)`,
    color: `hsl(${hue} 55% 30%)`,
  };
}

function relativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "not yet checked";
  const diffMs = Math.max(0, now.getTime() - then.getTime());
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function reliabilityStatusClass(label: string): string {
  if (label === "Live") return styles.statusLive;
  if (label === "New" || label === "Stale") return styles.statusUnproven;
  return "";
}

/**
 * monitorCount is derived from corroborationSources (the count of distinct
 * independent evidence source types -- probes, GitHub, NIP-66 -- per
 * src/ranking/reliability.ts), not sourceTypes.filter(nip66). A single
 * candidate has at most one nip66 entry in sourceTypes, so that count would
 * only ever read as 0 or 1 and wouldn't describe "independent monitors"
 * meaningfully.
 */
function toReliabilityFacts(community: DirectoryCommunity): ReliabilityFacts {
  return {
    adoptionPubkeys: community.adoptionPubkeys,
    adoptionRepos: community.adoptionRepos,
    evidenceSufficient: community.evidenceSufficient,
    lastVerifiedAt: community.lastVerifiedAt,
    metadataChangedAt: community.metadataChangedAt,
    monitorCount: community.corroborationSources,
    probesSuccessful: community.probesSuccessful,
    probesTotal: community.probesTotal,
    reliabilityScore: community.reliabilityScore,
  };
}

function buildHref(
  filters: Filters,
  overrides: Partial<Filters> & { selected?: string },
): string {
  const merged = { ...filters, ...overrides };
  const params = new URLSearchParams();
  if (merged.q) params.set("q", merged.q);
  if (merged.focus) params.set("focus", merged.focus);
  if (merged.joinable) params.set("joinable", merged.joinable);
  if (overrides.selected) params.set("selected", overrides.selected);
  const qs = params.toString();
  return `/${qs ? `?${qs}` : ""}`;
}
