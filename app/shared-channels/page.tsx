import type { Metadata } from "next";

import { SharedChannelFlow } from "./shared-channel-flow";
import { SharedChannelsClient } from "./shared-channels-client";
import styles from "./shared-channels.module.css";

export const metadata: Metadata = {
  title: "Connect | BuzzRouter",
};

export default function SharedChannelsPage() {
  return (
    <main className={styles.page}>
        <header className={styles.header}>
          <h1>Connect</h1>
          <p className={styles.explainerLead}>
            <strong>
              Connect one channel to the open BuzzRouter hub.
            </strong>{" "}
            Your community keeps talking at home while BuzzRouter mirrors
            messages to every other participating community. To keep the
            connection private, switch the community filter to one selected
            community.
          </p>
        </header>
        <SharedChannelFlow />
        <SharedChannelsClient />
    </main>
  );
}
