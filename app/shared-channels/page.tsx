import type { Metadata } from "next";

import chrome from "../site-chrome.module.css";
import { SiteMasthead } from "../SiteMasthead";
import { SharedChannelsClient } from "./shared-channels-client";
import styles from "./shared-channels.module.css";

export const metadata: Metadata = {
  title: "Shared channels | BuzzRouter",
};

export default function SharedChannelsPage() {
  return (
    <div className={chrome.siteCanvas}>
      <SiteMasthead current="shared-channels" />
      <main className={styles.page}>
      <header className={styles.header}>
        <p>Community administration</p>
        <h1>Shared channels</h1>
      </header>
      <section aria-labelledby="how-it-works" className={styles.explainer}>
        <p className={styles.explainerLead}>
          A shared channel connects two Buzz communities. Each community keeps
          a channel of its own, and BuzzRouter mirrors messages and threads
          between them with visible attribution &mdash; members simply talk in
          their home community, no new app or protocol required.
        </p>
        <h2 id="how-it-works">How to set one up</h2>
        <ol className={styles.steps}>
          <li>
            <strong>Connect your owner key.</strong> Sign in below with the
            Nostr key that owns your verified community.
          </li>
          <li>
            <strong>Add the BuzzRouter bot.</strong>{" "}
            Paste an invite link from your Buzz app below and the bot joins
            your community as a member &mdash; no key handling and no server
            access. Owners who run their own relay can still admit the bridge
            by key or from a shell instead.
          </li>
          <li>
            <strong>Propose a channel.</strong> Pick a community from the
            directory and send its owner a shared-channel invitation.
          </li>
          <li>
            <strong>Collaborate.</strong> Once the other owner accepts and
            picks a channel on their side, the two channels mirror each
            other. Either owner can pause or disconnect at any time.
          </li>
        </ol>
      </section>
      <SharedChannelsClient />
      </main>
    </div>
  );
}
