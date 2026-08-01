import { listDirectoryCommunities } from "../../src/db/directory";
import { getDatabasePool } from "../../src/db/pool";
import chrome from "../site-chrome.module.css";
import { SiteMasthead } from "../SiteMasthead";
import { JoinClient, type JoinableCommunity } from "./JoinClient";
import styles from "./join.module.css";

export const dynamic = "force-dynamic";

export default async function JoinPage() {
  const communities = await loadJoinable();

  return (
    <div className={chrome.siteCanvas}>
      <SiteMasthead current="join" />
      <div className={styles.page}>
        <header className={styles.header}>
          <p>No key, no install</p>
          <h1>Join a community</h1>
          <span>
            Pick a community and press Join. BuzzRouter creates and holds a
            Nostr identity for you, so you can move in and out of communities
            without a wallet, an extension, or knowing what any of that means.
          </span>
        </header>
        <JoinClient communities={communities} />
      </div>
    </div>
  );
}

async function loadJoinable(): Promise<JoinableCommunity[]> {
  const all = await listDirectoryCommunities(getDatabasePool(), { limit: 200 });
  return all
    // Managed click-to-join claims an invite on the user's behalf, so only
    // communities that expose an invite code are joinable this way.
    .filter((community) => Boolean(community.inviteCode))
    .map((community) => ({
      description: community.tagline ?? community.description,
      displayName: community.displayName ?? community.relayHost,
      focus: community.focus,
      host: community.relayHost,
    }));
}
