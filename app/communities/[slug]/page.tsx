import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDatabasePool } from "../../../src/db/pool";
import { getPublicCommunity } from "../../../src/claims/store";

import styles from "./community.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const community = await getPublicCommunity(
    getDatabasePool(),
    (await params).slug,
  );
  return {
    description: community?.description,
    title: community
      ? `${community.displayName} | BuzzRouter`
      : "Community | BuzzRouter",
  };
}

export default async function CommunityPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const community = await getPublicCommunity(
    getDatabasePool(),
    (await params).slug,
  );
  if (!community) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <nav>
        <a className={styles.brand} href="/">
          BuzzRouter
        </a>
        <span>Verified community</span>
      </nav>

      <header>
        <div className={styles.categories}>
          {community.categories.map((category) => (
            <span key={category}>{category}</span>
          ))}
        </div>
        <h1>{community.displayName}</h1>
        <p>{community.description}</p>
        <div className={styles.actions}>
          {community.joinUrl ? (
            <a className={styles.primary} href={community.joinUrl}>
              {community.joinMode === "public_link"
                ? "Join community"
                : "Request invite"}
            </a>
          ) : (
            <span className={styles.invite}>Invite required</span>
          )}
          <a href={community.canonicalRelayUrl}>View relay endpoint</a>
        </div>
      </header>

      <section className={styles.details}>
        <div>
          <span>Relay</span>
          <code>{community.canonicalRelayUrl}</code>
        </div>
        <div>
          <span>Ownership</span>
          <strong>Cryptographically verified</strong>
        </div>
        <div>
          <span>Relay checked</span>
          <strong>
            {new Intl.DateTimeFormat("en", {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(new Date(community.lastVerifiedAt))}
          </strong>
        </div>
      </section>
    </main>
  );
}
