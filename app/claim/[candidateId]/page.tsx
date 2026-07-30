import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getDatabasePool } from "../../../src/db/pool";
import { isUuid } from "../../../src/claims/http";
import { getClaimWorkspace } from "../../../src/claims/store";

import { ClaimWorkspaceClient } from "./workspace";
import styles from "./claim.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Claim community | BuzzRouter",
};

export default async function ClaimPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = await params;
  if (!isUuid(candidateId)) {
    notFound();
  }
  const workspace = await getClaimWorkspace(
    getDatabasePool(),
    candidateId,
  );
  if (!workspace) {
    notFound();
  }

  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          BuzzRouter
        </a>
        <a href={workspace.canonicalRelayUrl}>Relay endpoint</a>
      </nav>

      <header className={styles.header}>
        <p>Community ownership</p>
        <h1>{workspace.displayName ?? workspace.host}</h1>
        <code>{workspace.canonicalRelayUrl}</code>
      </header>

      <ClaimWorkspaceClient workspace={workspace} />
    </main>
  );
}
