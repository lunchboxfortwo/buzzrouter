import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCommunityByHost } from "../../../src/db/directory";
import { getCandidateInviteTarget } from "../../../src/db/join-probes";
import { getDatabasePool } from "../../../src/db/pool";
import { isUuid } from "../../../src/http/validation";
import { getJoinPolicy, type JoinPolicy } from "../../../src/presence/policy";
import { buildInviteUrl } from "../../join-urls";
import chrome from "../../site-chrome.module.css";
import { SiteMasthead } from "../../SiteMasthead";
import { JoinConsent } from "./JoinConsent";
import styles from "./join.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Join a community · BuzzRouter",
  robots: { follow: false, index: false },
};

export default async function JoinPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  if (!isUuid(candidateId)) notFound();

  const pool = getDatabasePool();
  const target = await getCandidateInviteTarget(pool, candidateId);
  if (!target) notFound();

  const community = await getCommunityByHost(pool, target.host);
  const displayName = community?.displayName ?? target.host;
  const hostedFallbackUrl = buildInviteUrl(target.canonicalRelayUrl, target.code);

  // Owner-only / allowlist: a code will not admit a new member. Say so rather
  // than run a consent flow whose claim would be refused.
  if (community?.joinStatus === "restricted") {
    return (
      <Shell displayName={displayName} host={target.host}>
        <p className={styles.lead}>
          <strong>{displayName}</strong> is invite-only. Its owner admits members
          from an allowlist, so an invite code alone will not get you in.
        </p>
        <p className={styles.muted}>
          Ask an admin of the community for a personal invite.
        </p>
        <Link className={styles.back} href="/">
          ← Back to the directory
        </Link>
      </Shell>
    );
  }

  // The live policy is fetched at render for DISPLAY only — never a receipt,
  // which is short-lived and minted on the consent click (see JoinConsent).
  let policy: JoinPolicy | null = null;
  try {
    policy = await getJoinPolicy(target.host);
  } catch {
    policy = null;
  }

  return (
    <Shell displayName={displayName} host={target.host}>
      <JoinConsent
        ageAttestationRequired={policy?.ageAttestationRequired ?? false}
        candidateId={candidateId}
        code={target.code}
        displayName={displayName}
        hostedFallbackUrl={hostedFallbackUrl}
        policyUnavailable={policy === null}
        policyVersion={policy?.version ?? ""}
        privacyMarkdown={policy?.privacyMarkdown ?? null}
        relayUrl={target.canonicalRelayUrl}
        termsMarkdown={policy?.termsMarkdown ?? null}
      />
    </Shell>
  );
}

function Shell({
  children,
  displayName,
  host,
}: {
  children: React.ReactNode;
  displayName: string;
  host: string;
}) {
  return (
    <div className={chrome.siteCanvas}>
      <SiteMasthead current="discover" />
      <main className={styles.page}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>Community invite</p>
          <h1 className={styles.title}>Join {displayName}</h1>
          <div className={styles.host}>{host}</div>
          {children}
        </div>
      </main>
    </div>
  );
}
