import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getDatabasePool } from "../../../src/db/pool";
import {
  listCandidateReviews,
  listSourceStateReviews,
} from "../../../src/db/review";
import { isInternalReviewAuthorized } from "../../../src/internal/auth";

import styles from "./review.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Discovery Review | BuzzRouter",
};

export default async function DiscoveryReviewPage() {
  const requestHeaders = await headers();
  if (!isInternalReviewAuthorized(requestHeaders)) {
    notFound();
  }

  const pool = getDatabasePool();
  const [candidates, sourceStates] = await Promise.all([
    listCandidateReviews(pool),
    listSourceStateReviews(pool),
  ]);
  const eligible = candidates.filter(
    (candidate) => candidate.eligibility.eligible,
  ).length;
  const verified = candidates.filter(
    (candidate) => candidate.state === "verified_buzz",
  ).length;

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>BuzzRouter operations</p>
          <h1>Discovery review</h1>
        </div>
        <span className={styles.updated}>
          {formatTimestamp(new Date().toISOString())}
        </span>
      </header>

      <section className={styles.metrics} aria-label="Candidate summary">
        <Metric label="Candidates" value={candidates.length} />
        <Metric label="Verified Buzz" value={verified} />
        <Metric label="Listing eligible" value={eligible} />
        <Metric label="Sources" value={sourceStates.length} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Source health</h2>
        </div>
        <div className={styles.sourceStrip}>
          {sourceStates.length === 0 ? (
            <p className={styles.empty}>No source runs recorded.</p>
          ) : (
            sourceStates.map((source) => (
              <div className={styles.sourceItem} key={source.key}>
                <div>
                  <strong>{source.key}</strong>
                  <span>
                    {source.lastSuccessAt
                      ? formatTimestamp(source.lastSuccessAt)
                      : "Never succeeded"}
                  </span>
                </div>
                <Status
                  tone={source.lastErrorCode ? "danger" : "healthy"}
                  value={source.lastErrorCode ?? "healthy"}
                />
              </div>
            ))
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>Candidate evidence</h2>
          <span>{candidates.length} most recently observed</span>
        </div>

        <div className={styles.tableViewport}>
          <table>
            <thead>
              <tr>
                <th>Relay</th>
                <th>Technical state</th>
                <th>Evidence</th>
                <th>Eligibility</th>
                <th>Last observed</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr key={candidate.id}>
                  <td>
                    <code className={styles.relay}>
                      {candidate.canonicalRelayUrl}
                    </code>
                  </td>
                  <td>
                    <Status
                      tone={
                        candidate.state === "verified_buzz"
                          ? "healthy"
                          : candidate.state === "rejected"
                            ? "danger"
                            : "neutral"
                      }
                      value={candidate.state}
                    />
                  </td>
                  <td>
                    <div className={styles.sourceList}>
                      {[...new Set(
                        candidate.sources.map((source) => source.type),
                      )].map((type) => (
                        <span key={type}>{type}</span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <Status
                      tone={
                        candidate.eligibility.eligible
                          ? "healthy"
                          : "warning"
                      }
                      value={candidate.eligibility.reason}
                    />
                  </td>
                  <td>{formatTimestamp(candidate.lastSeenAt)}</td>
                  <td>
                    <details>
                      <summary>Inspect</summary>
                      <div className={styles.details}>
                        <DetailSources sources={candidate.sources} />
                        <DetailProbes probes={candidate.recentProbes} />
                      </div>
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {candidates.length === 0 ? (
            <p className={styles.empty}>No candidates indexed.</p>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.metric}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Status({
  tone,
  value,
}: {
  tone: "danger" | "healthy" | "neutral" | "warning";
  value: string;
}) {
  return <span className={`${styles.status} ${styles[tone]}`}>{value}</span>;
}

function DetailSources({
  sources,
}: {
  sources: Awaited<ReturnType<typeof listCandidateReviews>>[number]["sources"];
}) {
  return (
    <div>
      <strong>Sources</strong>
      {sources.map((source, index) => (
        <p key={`${source.type}-${source.actorPubkey}-${index}`}>
          {source.type}
          {source.actorPubkey
            ? ` · ${source.actorPubkey.slice(0, 12)}`
            : ""}
          {source.locator ? (
            <>
              {" · "}
              <a href={source.locator}>evidence</a>
            </>
          ) : null}
        </p>
      ))}
    </div>
  );
}

function DetailProbes({
  probes,
}: {
  probes: Awaited<ReturnType<typeof listCandidateReviews>>[number]["recentProbes"];
}) {
  return (
    <div>
      <strong>Recent probes</strong>
      {probes.map((probe) => (
        <p key={probe.probedAt}>
          {formatTimestamp(probe.probedAt)} · {probe.resultCode}
          {probe.websocketOpenMs !== null
            ? ` · ${probe.websocketOpenMs} ms`
            : ""}
        </p>
      ))}
    </div>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
