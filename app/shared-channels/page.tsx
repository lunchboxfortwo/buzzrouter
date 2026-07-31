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
      <SharedChannelsClient />
      </main>
    </div>
  );
}
