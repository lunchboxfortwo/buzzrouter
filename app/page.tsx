import Image from "next/image";

import {
  DIRECTORY_SORTS,
  listDirectoryCommunities,
  type DirectoryCommunity,
  type DirectorySort,
} from "../src/db/directory";
import { getDatabasePool } from "../src/db/pool";

import styles from "./directory.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PageSearchParams {
  category?: string | string[];
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
  const category = firstValue(params.category).trim().toLowerCase();
  const search = firstValue(params.q).trim().slice(0, 100);
  const requestedSort = firstValue(params.sort);
  const sort: DirectorySort = DIRECTORY_SORTS.includes(
    requestedSort as DirectorySort,
  )
    ? (requestedSort as DirectorySort)
    : "evidence";
  const communities = await listDirectoryCommunities(getDatabasePool(), {
    category,
    search,
    sort,
  });
  const selectedId = firstValue(params.selected);
  const selected =
    communities.find(
      (community) => community.candidateId === selectedId,
    ) ?? communities[0];
  const categoryCount = new Set(
    communities.flatMap((community) => community.categories),
  ).size;

  return (
    <div className={styles.page}>
      <a className={styles.skipLink} href="#directory">
        Skip to directory
      </a>

      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="/" aria-label="BuzzRouter home">
            <Image
              alt=""
              className={styles.logo}
              height={32}
              priority
              src="/assets/brand/buzzrouter-logo.png"
              width={32}
            />
            <span>BuzzRouter</span>
          </a>
          <nav aria-label="Primary navigation">
            <a aria-current="page" href="/">
              Discover
            </a>
            <a href="/submit">Submit</a>
          </nav>
          <span className={styles.liveStatus}>
            <span aria-hidden="true" />
            Live index
          </span>
        </div>
      </header>

      <main id="directory">
        <section className={styles.intro}>
          <div>
            <h1>Find your Buzz community</h1>
            <p className={styles.introCopy}>
              Browse communities by what they do, then open the one that fits
              in Buzz.
            </p>
          </div>
          <dl className={styles.metrics} aria-label="Directory status">
            <div>
              <dt>Communities</dt>
              <dd>{communities.length}</dd>
            </div>
            <div>
              <dt>Categories</dt>
              <dd>{categoryCount}</dd>
            </div>
          </dl>
        </section>

        <section className={styles.controls} aria-label="Directory controls">
          <form action="/" className={styles.searchForm}>
            <label htmlFor="directory-search">Search</label>
            <input
              defaultValue={search}
              id="directory-search"
              name="q"
              placeholder="Name, description, or category"
              type="search"
            />
            <label htmlFor="directory-sort">Sort</label>
            <select defaultValue={sort} id="directory-sort" name="sort">
              <option value="evidence">Strongest evidence</option>
              <option value="recent">Recently verified</option>
            </select>
            <label htmlFor="directory-category">Category</label>
            <select
              defaultValue={category}
              id="directory-category"
              name="category"
            >
              <option value="">All categories</option>
              <option value="builders">Builders</option>
              <option value="bitcoin">Bitcoin</option>
              <option value="privacy">Privacy</option>
              <option value="culture">Culture</option>
              <option value="gtm">GTM</option>
              <option value="labs">Labs</option>
            </select>
            <button type="submit">Apply</button>
          </form>
          <span>{communities.length} results</span>
        </section>

        {communities.length > 0 && selected ? (
          <section className={styles.workspace}>
            <div className={styles.results} aria-label="Community results">
              {communities.map((community) => (
                <CommunityRow
                  community={community}
                  category={category}
                  key={community.candidateId}
                  search={search}
                  selected={community.candidateId === selected.candidateId}
                  sort={sort}
                />
              ))}
            </div>
            <CommunityDetail community={selected} />
          </section>
        ) : (
          <section className={styles.empty}>
            <div className={styles.emptyMark}>B</div>
            <h2>{search ? "No matching communities" : "Index warming up"}</h2>
            <p>
              {search
                ? "Try a community name, description, or category."
                : "Candidates appear after a strict Buzz relay verification succeeds."}
            </p>
            {search ? <a href="/">Clear search</a> : null}
          </section>
        )}

      </main>

      <footer className={styles.footer}>
        <span>BuzzRouter</span>
        <span>Independent public index for Buzz communities.</span>
      </footer>
    </div>
  );
}

function CommunityRow({
  category,
  community,
  search,
  selected,
  sort,
}: {
  category: string;
  community: DirectoryCommunity;
  search: string;
  selected: boolean;
  sort: DirectorySort;
}) {
  const params = new URLSearchParams({
    selected: community.candidateId,
    sort,
  });
  if (search) {
    params.set("q", search);
  }
  if (category) {
    params.set("category", category);
  }

  return (
    <a
      aria-current={selected ? "true" : undefined}
      className={styles.result}
      href={`/?${params.toString()}`}
    >
      <span className={styles.monogram} aria-hidden="true">
        {community.displayName.slice(0, 1).toUpperCase()}
        {community.iconUrl ? (
          <Image
            alt=""
            className={styles.communityIcon}
            height={40}
            src={community.iconUrl}
            unoptimized
            width={40}
          />
        ) : null}
      </span>
      <span className={styles.resultMain}>
        <span className={styles.resultHeading}>
          <strong>{community.displayName}</strong>
          {community.categories[0] ? (
            <span className={styles.resultCategory}>
              {categoryLabel(community.categories[0])}
            </span>
          ) : null}
        </span>
        <span className={styles.resultBlurb}>
          {community.description ?? "Community description not published yet."}
        </span>
      </span>
      <span className={styles.resultMeta}>
        <span className={styles.verified}>
          <span aria-hidden="true" />
          Verified
        </span>
        <span>{community.evidenceCount} evidence</span>
      </span>
      <span className={styles.chevron} aria-hidden="true">
        ›
      </span>
    </a>
  );
}

function CommunityDetail({
  community,
}: {
  community: DirectoryCommunity;
}) {
  const primaryUrl =
    community.joinUrl ??
    (community.slug
      ? `/communities/${community.slug}`
      : buzzJoinUrl(community));
  const primaryLabel = community.joinUrl
    ? community.joinMode === "public_link"
      ? "Join community"
      : "Request invite"
    : community.slug
      ? "View community"
      : "Open in Buzz";

  return (
    <aside className={styles.detail} aria-label={community.displayName}>
      <div className={styles.detailHeader}>
        <span className={styles.detailMonogram} aria-hidden="true">
          {community.displayName.slice(0, 1).toUpperCase()}
          {community.iconUrl ? (
            <Image
              alt=""
              className={styles.communityIcon}
              height={54}
              src={community.iconUrl}
              unoptimized
              width={54}
            />
          ) : null}
        </span>
        <div>
          <div className={styles.detailTitle}>
            <h2>{community.displayName}</h2>
            {community.claimed ? (
              <span className={styles.claimed}>Claimed</span>
            ) : null}
          </div>
          <code>{community.canonicalRelayUrl}</code>
        </div>
      </div>

      <p className={styles.description}>
        {community.description ??
          `A verified Buzz community at ${community.relayHost}.`}
      </p>

      {community.categories.length > 0 ? (
        <div className={styles.tags} aria-label="Categories">
          {community.categories.map((category) => (
            <span key={category}>{categoryLabel(category)}</span>
          ))}
        </div>
      ) : null}

      <div className={styles.actions}>
        <a className={styles.primaryAction} href={primaryUrl}>
          {primaryLabel}
        </a>
        {!community.claimed ? (
          <a href={`/claim/${community.candidateId}`}>Claim listing</a>
        ) : null}
      </div>

      <div className={styles.factGrid}>
        <div>
          <span>Last verified</span>
          <strong>{formatDate(community.lastVerifiedAt)}</strong>
        </div>
        <div>
          <span>Handshake</span>
          <strong>
            {community.websocketOpenMs === null
              ? "Confirmed"
              : `${community.websocketOpenMs} ms`}
          </strong>
        </div>
        <div>
          <span>Evidence</span>
          <strong>{community.evidenceCount} public records</strong>
        </div>
        <div>
          <span>Access</span>
          <strong>
            {community.authRequired ? "Authentication required" : "Open relay"}
          </strong>
        </div>
      </div>

      <section className={styles.detailSection}>
        <h3>Discovery evidence</h3>
        <div className={styles.tags}>
          {community.sourceTypes.map((source) => (
            <span key={source}>{sourceLabel(source)}</span>
          ))}
        </div>
      </section>

      <section className={styles.detailSection}>
        <h3>Protocol profile</h3>
        <p>
          Buzz {community.softwareVersion ?? "version not reported"}
          {community.supportedNips.length > 0
            ? ` · NIPs ${community.supportedNips.slice(0, 8).join(", ")}`
            : ""}
        </p>
      </section>
    </aside>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    buzzdir: "Buzzdir catalog",
    github: "GitHub reference",
    manual: "Manual review",
    nip65: "NIP-65 relay list",
    nip66: "NIP-66 monitor",
    provider: "Provider intent",
    reviewed_seed: "Reviewed source",
    submission: "Community submission",
  };

  return labels[source] ?? source;
}

function buzzJoinUrl(community: DirectoryCommunity): string {
  const params = new URLSearchParams({
    name: community.displayName,
    relay: community.canonicalRelayUrl,
  });
  return `buzz://add-community?${params.toString()}`;
}

function categoryLabel(category: string): string {
  return category === "gtm"
    ? "GTM"
    : category.slice(0, 1).toUpperCase() + category.slice(1);
}
