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
            <strong>
              Shared channels on Buzz work like shared channels in Slack.
            </strong>{" "}
            Two communities each keep a channel of their own, and messages sent
            in one show up in the other. Add the BuzzRouter bot to the channel
            you want to share, then send messages there to reach the linked
            community.
          </p>
        </header>
        <SharedChannelsClient />
      </main>
    </div>
  );
}
