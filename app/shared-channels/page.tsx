import type { Metadata } from "next";

import { SharedChannelFlow } from "./shared-channel-flow";
import { SharedChannelsClient } from "./shared-channels-client";
import styles from "./shared-channels.module.css";

export const metadata: Metadata = {
  title: "Link | BuzzRouter",
};

export default function SharedChannelsPage() {
  return (
    <main className={styles.page}>
        <header className={styles.header}>
          <h1>Link</h1>
          <p className={styles.explainerLead}>
            <strong>
              Shared channels on Buzz work like shared channels in Slack.
            </strong>{" "}
            Two communities each keep a channel of their own, and messages sent
            in one show up in the other. Each community first admits the
            BuzzRouter bot; then the owners link their chosen channels.
          </p>
        </header>
        <SharedChannelFlow />
        <SharedChannelsClient />
    </main>
  );
}
