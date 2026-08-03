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
              Link one channel to the open BuzzRouter channel.
            </strong>{" "}
            Your community keeps talking at home while BuzzRouter mirrors
            messages to every other participating community. To keep a link
            private, switch the community filter to one selected community.
          </p>
        </header>
        <SharedChannelFlow />
        <SharedChannelsClient />
    </main>
  );
}
