import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getDatabasePool } from "../../../src/db/pool";
import {
  getCommunityByHost,
  listSimilarCommunities,
  type DirectoryCommunity,
} from "../../../src/db/directory";
import { getCommunitySummary } from "../../../src/db/presence";
import { reliabilityLabel } from "../../../src/ranking/explain";
import { focusLabel } from "../../../src/ranking/focus";
import { JoinButton } from "../../JoinButton";
import { ShareOnX } from "../../ShareOnX";
import styles from "./community.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function pageOrigin(): string {
  return process.env.PUBLIC_APP_ORIGIN ?? "https://buzzrouter.com";
}

async function loadCommunity(
  slug: string,
): Promise<DirectoryCommunity | null> {
  return getCommunityByHost(getDatabasePool(), decodeURIComponent(slug));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const community = await loadCommunity((await params).slug);
  if (!community) {
    return { title: "Community | BuzzRouter" };
  }
  const title = `${community.displayName} · Buzz community | BuzzRouter`;
  const description =
    community.description ??
    `${community.displayName} is a verified Buzz community, checked directly at the relay by BuzzRouter.`;
  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", site: "@buzzrouter", title, description },
  };
}

function monogram(name: string): string {
  const first = [...name.trim()].find((c) => /\p{L}|\p{N}/u.test(c));
  return (first ?? "B").toUpperCase();
}

function insigniaTone(host: string): { background: string } {
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return {
    background: `linear-gradient(135deg, hsl(${hash} 60% 94%), hsl(${(hash + 40) % 360} 60% 92%))`,
  };
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days <= 0) {
    const hours = Math.floor(ms / 3_600_000);
    return hours <= 1 ? "just now" : `${hours}h ago`;
  }
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function accessKind(c: DirectoryCommunity): "open" | "invite" | null {
  if (c.publicUrl) return "open";
  if (c.inviteCode) return "invite";
  return null;
}

function statusOf(c: DirectoryCommunity): string {
  return reliabilityLabel({
    adoptionPubkeys: c.adoptionPubkeys,
    adoptionRepos: c.adoptionRepos,
    evidenceSufficient: c.evidenceSufficient,
    lastVerifiedAt: c.lastVerifiedAt,
    metadataChangedAt: c.metadataChangedAt,
    monitorCount: c.corroborationSources,
    probesSuccessful: c.probesSuccessful,
    probesTotal: c.probesTotal,
    reliabilityScore: c.reliabilityScore,
  });
}

const ACTIVITY_LABEL: Record<string, string> = {
  active: "Active",
  busy: "Busy",
  light: "Light activity",
  quiet: "Quiet",
};

function activityLabel(level: string): string {
  return ACTIVITY_LABEL[level] ?? "Active";
}

function activityDotKey(
  level: string,
): "actBusy" | "actActive" | "actLight" | "actQuiet" {
  if (level === "busy") return "actBusy";
  if (level === "light") return "actLight";
  if (level === "quiet") return "actQuiet";
  return "actActive";
}

export default async function CommunityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const slug = (await params).slug;
  const community = await loadCommunity(slug);
  if (!community) {
    notFound();
  }

  const similar = await listSimilarCommunities(
    getDatabasePool(),
    community.focus,
    community.relayHost,
  );

  const summary = await getCommunitySummary(
    getDatabasePool(),
    community.relayHost,
  );

  const status = statusOf(community);
  const access = accessKind(community);
  const tone = insigniaTone(community.relayHost);
  const shareUrl = `${pageOrigin()}/communities/${encodeURIComponent(community.relayHost)}`;
  const shareText = `${community.displayName} — a real, live Buzz community, verified by @buzzrouter`;

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div className={styles.headIn}>
          <Link className={styles.brand} href="/">
            <Image alt="" height={34} priority src="/assets/brand/buzzrouter-logo.png" width={34} />
            <span>BuzzRouter</span>
          </Link>
          <Link className={styles.back} href="/">← All communities</Link>
        </div>
      </div>

      <div className={styles.wrap}>
        <div className={styles.hero}>
          {community.iconUrl ? (
            <Image alt="" className={styles.insignia} height={88} src={community.iconUrl} unoptimized width={88} />
          ) : (
            <span aria-hidden className={styles.insignia} style={tone}>
              {monogram(community.displayName)}
            </span>
          )}
          <div>
            <h1 className={styles.name}>{community.displayName}</h1>
            <div className={styles.host}>{community.canonicalRelayUrl}</div>
            <div className={styles.tags}>
              <span className={`${styles.pill} ${styles.pillLive}`}>
                <span className={styles.dot} />
                {status} · checked {relativeTime(community.lastVerifiedAt)}
              </span>
              {community.focus ? (
                <span className={`${styles.pill} ${styles.pillFocus}`}>
                  {focusLabel(community.focus)}
                </span>
              ) : null}
              {access === "open" ? (
                <span className={`${styles.pill} ${styles.pillOpen}`}>Open to join</span>
              ) : access === "invite" ? (
                <span className={`${styles.pill} ${styles.pillInvite}`}>Invite-only</span>
              ) : null}
            </div>
          </div>
          <div className={styles.heroActions}>
            <JoinButton
              className={styles.cta}
              communityName={community.displayName}
              inviteCode={community.inviteCode}
              publicUrl={community.publicUrl}
              relayUrl={community.canonicalRelayUrl}
            />
            <ShareOnX
              className={styles.heroShare}
              label="Share on X"
              text={shareText}
              url={shareUrl}
            />
          </div>
        </div>

        {summary ? (
          <section className={styles.pulse}>
            <div className={styles.pulseHead}>
              <span className={styles.pulseKicker}>
                <span
                  aria-hidden
                  className={`${styles.actDot} ${styles[activityDotKey(summary.activityLevel)]}`}
                />
                Inside the community
              </span>
              <span className={styles.pulseFresh}>
                Updated {relativeTime(summary.lastSummarizedAt)}
              </span>
            </div>
            <p className={styles.pulseGoals}>{summary.goals}</p>
            {summary.recentProjects.length > 0 ? (
              <>
                <h2 className={styles.pulseSubhead}>Recently working on</h2>
                <ul className={styles.pulseList}>
                  {summary.recentProjects.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <div className={styles.pulseStats}>
              <span className={styles.pulseStat}>
                <strong>{activityLabel(summary.activityLevel)}</strong>
              </span>
              <span className={styles.pulseStat}>
                <strong>{summary.activeMemberCount}</strong> active{" "}
                {summary.activeMemberCount === 1 ? "member" : "members"}
                {summary.totalMemberCount
                  ? ` of ${summary.totalMemberCount}`
                  : ""}
              </span>
              <span className={styles.pulseStat}>
                <strong>{summary.messageCount}</strong> messages · past{" "}
                {summary.windowDays}d
              </span>
            </div>
          </section>
        ) : community.description ? (
          <p className={styles.lede}>{community.description}</p>
        ) : (
          <p className={styles.lede}>
            A verified Buzz community — checked directly at the relay by
            BuzzRouter, not reported by the community.
          </p>
        )}

        {similar.length > 0 ? (
          <>
            <div className={styles.relLabel}>Similar communities</div>
            <div className={styles.relGrid}>
              {similar.map((peer) => (
                <Link
                  className={styles.relCard}
                  href={`/communities/${encodeURIComponent(peer.relayHost)}`}
                  key={peer.candidateId}
                >
                  {peer.iconUrl ? (
                    <Image alt="" className={styles.mono} height={40} src={peer.iconUrl} unoptimized width={40} />
                  ) : (
                    <span aria-hidden className={styles.mono} style={insigniaTone(peer.relayHost)}>
                      {monogram(peer.displayName)}
                    </span>
                  )}
                  <div>
                    <strong>{peer.displayName}</strong>
                    <span>{focusLabel(peer.focus)} · {statusOf(peer)}</span>
                  </div>
                </Link>
              ))}
            </div>
          </>
        ) : null}

        {community.openToSharedChannels ? (
          <div className={styles.connect}>
            <span className={styles.connectIcon}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#5657f2" strokeWidth="1.8" strokeLinecap="round">
                <path d="M8.5 15.5l7-7" /><circle cx="6" cy="18" r="2.5" /><circle cx="18" cy="6" r="2.5" />
              </svg>
            </span>
            <div>
              <strong>Open to shared channels</strong>
              <span>This community welcomes cross-community collaboration through BuzzRouter.</span>
            </div>
            <Link href="/shared-channels">Propose a shared channel →</Link>
          </div>
        ) : null}
      </div>
    </div>
  );
}
