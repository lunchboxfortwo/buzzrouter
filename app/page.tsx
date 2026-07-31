import Image from "next/image";
import Link from "next/link";

import { listDirectoryCommunities, type DirectoryCommunity } from "../src/db/directory";
import { getDatabasePool } from "../src/db/pool";
import {
  aboutText,
  currentWork,
  explainChecks,
  reliabilityLabel,
  type ReliabilityFacts,
} from "../src/ranking/explain";
import { focusLabel } from "../src/ranking/focus";

import { AutoSubmitSelect } from "./AutoSubmitSelect";
import { CopyRelayButton } from "./CopyRelayButton";
import styles from "./directory.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SortOption = "reliable" | "new";

interface Filters {
  access: "all" | "invite";
  focus: string;
  q: string;
  sort: SortOption;
}

interface PageSearchParams {
  access?: string | string[];
  focus?: string | string[];
  q?: string | string[];
  selected?: string | string[];
  sort?: string | string[];
}

export default async function DirectoryPage({
  searchParams,
}: {
  searchParams: Promise<PageSearchParams>;
}) {
  const params = await searchParams;
  const search = firstValue(params.q).trim().slice(0, 100);
  const sort: SortOption = firstValue(params.sort) === "new" ? "new" : "reliable";
  const focusFilter = firstValue(params.focus).trim();
  const accessFilter: "all" | "invite" =
    firstValue(params.access) === "invite" ? "invite" : "all";
  const filters: Filters = { access: accessFilter, focus: focusFilter, q: search, sort };

  const allCommunities = await listDirectoryCommunities(getDatabasePool(), {
    search,
    sort,
  });

  const focusCoverage = allCommunities.length
    ? allCommunities.filter((community) => Boolean(community.focus)).length /
      allCommunities.length
    : 0;
  const hasFocusData = focusCoverage >= 0.5;
  const focusOptions = hasFocusData
    ? Array.from(
        new Set(
          allCommunities.flatMap((community) =>
            community.focus ? [community.focus] : [],
          ),
        ),
      ).sort((a, b) => focusLabel(a).localeCompare(focusLabel(b)))
    : [];

  const communities = allCommunities.filter((community) => {
    if (accessFilter === "invite" && community.authRequired !== true) return false;
    if (focusFilter && community.focus !== focusFilter) return false;
    return true;
  });

  const selectedId = firstValue(params.selected);
  const selected =
    communities.find((community) => community.candidateId === selectedId) ??
    communities[0];
  const filtersApplied = Boolean(search || focusFilter || accessFilter !== "all");

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#directory">
        Skip to directory
      </a>

      <form action="/" className={styles.formShell} method="GET">
        {selected ? (
          <input name="selected" type="hidden" value={selected.candidateId} />
        ) : null}

        <header className={styles.header}>
          <div className={styles.headerInner}>
            <a
              aria-label="BuzzRouter directory"
              className={styles.brand}
              href="/"
            >
              <Image
                alt=""
                className={styles.logo}
                height={34}
                priority
                src="/assets/brand/buzzrouter-logo.png"
                width={34}
              />
              <span>BuzzRouter</span>
            </a>

            <nav aria-label="Primary navigation" className={styles.nav}>
              <a aria-current="page" className={styles.navLink} href="/">
                Discover
              </a>
              <Link className={styles.navLink} href="/submit">List a community</Link>
            </nav>

            <div className={styles.searchField}>
              <label className={styles.visuallyHidden} htmlFor="community-search">
                Search communities
              </label>
              <svg aria-hidden="true" className={styles.searchIcon} viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" />
                <path d="m16.5 16.5 4 4" />
              </svg>
              <input
                className={styles.searchInput}
                defaultValue={search}
                id="community-search"
                name="q"
                placeholder="Search communities or topics"
                type="search"
              />
            </div>
          </div>
        </header>

        <main id="directory">
          <div className={styles.workspaceShell}>
            <header className={styles.premiseBand}>
              <div>
                <h1 className={styles.premiseHeading}>
                  Find a Buzz community{" "}
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
                  Every listing is checked at the relay itself.
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

            <section aria-label="Filter and sort communities" className={styles.commandBar}>
              {hasFocusData ? (
                <label className={styles.commandFilter}>
                  <span>Focus</span>
                  <AutoSubmitSelect defaultValue={focusFilter} name="focus">
                    <option value="">Any focus</option>
                    {focusOptions.map((focus) => (
                      <option key={focus} value={focus}>
                        {focusLabel(focus)}
                      </option>
                    ))}
                  </AutoSubmitSelect>
                </label>
              ) : null}
              <label className={styles.commandFilter}>
                <span>Sort</span>
                <AutoSubmitSelect defaultValue={sort} name="sort">
                  <option value="reliable">Most active</option>
                  <option value="new">Recently discovered</option>
                </AutoSubmitSelect>
              </label>
              <noscript>
                <button className={styles.applyButton} type="submit">
                  Apply
                </button>
              </noscript>
              <span className={styles.resultCount}>
                <strong>{communities.length}</strong>{" "}
                {communities.length === 1 ? "result" : "results"}
              </span>
            </section>

            <div aria-label="Filter by access" className={styles.accessRail} role="group">
              <a
                aria-pressed={accessFilter === "all"}
                className={styles.accessChip}
                href={buildHref(filters, { access: "all", selected: undefined })}
                role="button"
              >
                All
              </a>
              <a
                aria-pressed={accessFilter === "invite"}
                className={styles.accessChip}
                href={buildHref(filters, { access: "invite", selected: undefined })}
                role="button"
              >
                Invite-only
              </a>
            </div>

            <div className={styles.workspaceGrid}>
              <section
                aria-labelledby="directory-results-title"
                className={`${styles.communityIndex} ${hasFocusData ? "" : styles.indexNoFocus}`}
              >
                <div aria-hidden="true" className={styles.indexHeader}>
                  <span>Community</span>
                  {hasFocusData ? <span>Focus</span> : null}
                  <span>Status</span>
                  <span>Freshness</span>
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
                          showFocus={hasFocusData}
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

            <section aria-label="Directory actions" className={styles.workspaceActions}>
              <p>
                BuzzRouter links you to each community&rsquo;s own Buzz relay; joining
                happens there.
              </p>
            </section>

          </div>
        </main>
      </form>

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
  showFocus,
}: {
  community: DirectoryCommunity;
  filters: Filters;
  selected: boolean;
  showFocus: boolean;
}) {
  const label = reliabilityLabel(toReliabilityFacts(community));
  const statusClass = reliabilityStatusClass(label);
  const tone = insigniaTone(community.relayHost);

  return (
    <a
      aria-current={selected ? "true" : undefined}
      className={styles.indexRow}
      href={buildHref(filters, { selected: community.candidateId })}
    >
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
            {community.authRequired ? (
              <span className={`${styles.accessFlag} ${styles.accessFlagInvite}`}>
                Invite-only
              </span>
            ) : (
              <span className={`${styles.accessFlag} ${styles.accessFlagOpen}`}>
                Open to join
              </span>
            )}
          </span>
          <small className={styles.indexSummary}>{community.relayHost}</small>
        </span>
      </span>
      {showFocus ? (
        <span className={styles.indexFocusCell}>
          {community.focus ? focusLabel(community.focus) : "—"}
        </span>
      ) : null}
      <span className={`${styles.indexStatusCell} ${statusClass}`}>
        <span aria-hidden="true" className={styles.statusDot} />
        {label}
      </span>
      <span className={styles.indexFreshnessCell}>
        {relativeTime(community.lastVerifiedAt)}
      </span>
      <svg aria-hidden="true" className={styles.indexRowArrow} viewBox="0 0 24 24">
        <path d="m9 6 6 6-6 6" />
      </svg>
    </a>
  );
}

function CommunityInspector({ community }: { community: DirectoryCommunity }) {
  const facts = toReliabilityFacts(community);
  const label = reliabilityLabel(facts);
  const statusClass = reliabilityStatusClass(label);
  const tone = insigniaTone(community.relayHost);
  const about = aboutText(community.description);
  const work = currentWork({
    claimed: community.claimed,
    operatorStatement: null,
    softwareVersion: community.softwareVersion,
    supportedNips: community.supportedNips,
  });
  const checks = explainChecks(facts);

  return (
    <article aria-labelledby="inspector-title" className={styles.communityInspector}>
      <header className={styles.inspectorHeader}>
        <div className={styles.inspectorHeading}>
          <span aria-hidden="true" className={styles.inspectorInsignia} style={tone}>
            {monogram(community.displayName)}
          </span>
          <div>
            <h2 className={styles.inspectorTitle} id="inspector-title">
              {community.displayName}
            </h2>
            <p className={styles.inspectorSummary}>
              {community.description ?? `A Buzz community at ${community.relayHost}.`}
            </p>
            <div className={styles.inspectorStatus}>
              <span className={`${styles.indexStatusCell} ${statusClass}`}>
                <span aria-hidden="true" className={styles.statusDot} />
                {label}
              </span>
              <span>Checked {relativeTime(community.lastVerifiedAt)}</span>
              {community.authRequired ? (
                <span className={`${styles.accessFlag} ${styles.accessFlagInvite}`}>
                  Invite-only
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <CopyRelayButton
          className={styles.copyButton}
          communityName={community.displayName}
          relayUrl={community.canonicalRelayUrl}
        />
      </header>

      <dl className={styles.inspectorMetrics}>
        <div className={styles.metricTile}>
          <dt>Uptime &middot; 30d</dt>
          <dd>
            {uptimeLabel(community)}
            <span className={styles.metricNote}>
              {community.evidenceSufficient
                ? "Successful relay checks"
                : "Not enough evidence yet"}
            </span>
          </dd>
        </div>
        <div className={styles.metricTile}>
          <dt>Last checked</dt>
          <dd>
            {relativeTime(community.lastVerifiedAt)}
            <span className={styles.metricNote}>Most recent relay probe</span>
          </dd>
        </div>
      </dl>

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

      <div className={styles.inspectorSections}>
        {community.claimed && work ? (
          <section className={styles.inspectorSection}>
            <h3>Current work</h3>
            <p>{work.text}</p>
            <small>
              {work.kind === "operator"
                ? "Shared by the community’s operator."
                : "Observed from the relay’s own published metadata."}
            </small>
          </section>
        ) : null}
        <section className={styles.inspectorSection}>
          <h3>What we checked</h3>
          <ul className={styles.reasonList}>
            {checks.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
          <small>These are the ranking inputs, not a written summary.</small>
        </section>
        <section className={styles.inspectorSection}>
          <h3>About</h3>
          <p>{about.text}</p>
          <small>From the relay&rsquo;s own published details.</small>
        </section>
      </div>

      {community.slug ? (
        <footer className={styles.inspectorFooter}>
          <a href={`/communities/${community.slug}`}>View full profile</a>
        </footer>
      ) : null}
    </article>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
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

function uptimeLabel(community: DirectoryCommunity): string {
  if (!community.evidenceSufficient || community.probesTotal <= 0) return "—";
  return `${Math.round((community.probesSuccessful / community.probesTotal) * 100)}%`;
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
  if (merged.sort && merged.sort !== "reliable") params.set("sort", merged.sort);
  if (merged.focus) params.set("focus", merged.focus);
  if (merged.access && merged.access !== "all") params.set("access", merged.access);
  if (overrides.selected) params.set("selected", overrides.selected);
  const qs = params.toString();
  return `/${qs ? `?${qs}` : ""}`;
}
