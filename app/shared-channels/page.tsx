import type { Metadata } from "next";

import { SharedChannelsClient } from "./shared-channels-client";
import styles from "./shared-channels.module.css";

export const metadata: Metadata = {
  title: "Shared channels | BuzzRouter",
};

export default function SharedChannelsPage() {
  return (
    <main className={styles.page}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="/">
          BuzzRouter
        </a>
        <a href="/">Directory</a>
      </nav>
      <header className={styles.header}>
        <p>Community administration</p>
        <h1>Shared channels</h1>
      </header>
      <SharedChannelsClient />
    </main>
  );
}
