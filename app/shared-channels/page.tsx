import type { Metadata } from "next";

import chrome from "../site-chrome.module.css";
import { SiteMasthead } from "../SiteMasthead";
import { SharedChannelsClient } from "./shared-channels-client";
import styles from "./shared-channels.module.css";

export const metadata: Metadata = {
  title: "Link | BuzzRouter",
};

export default function SharedChannelsPage() {
  return (
    <div className={chrome.siteCanvas}>
      <SiteMasthead current="shared-channels" />
      <main className={styles.page}>
        <header className={styles.header}>
          <h1>Link</h1>
          <p className={styles.explainerLead}>
            Share channels with different communities.
          </p>
        </header>
        <SharedChannelsClient />
      </main>
    </div>
  );
}
