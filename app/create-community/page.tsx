import { headers } from "next/headers";

import chrome from "../site-chrome.module.css";
import { SiteMasthead } from "../SiteMasthead";

import styles from "./create-community.module.css";
import { CreateCommunityForm } from "./CreateCommunityForm";
import { DownloadCta } from "./DownloadCta";
import { detectPlatform } from "./platform";

const PLATFORM_LABEL: Record<string, string> = {
  linux: "Linux",
  macos: "macOS",
  windows: "Windows",
};

export default async function CreateCommunityPage() {
  const headerList = await headers();
  const platform = detectPlatform(headerList.get("user-agent"));

  return (
    <div className={chrome.siteCanvas}>
      <SiteMasthead current="create" />
      <div className={styles.page}>
        <main>
          <section className={styles.intro}>
            <h1>Create a community</h1>
            <span>
              Pick a name and we&apos;ll set up a hosted Buzz community for you —
              no desktop app, no wallet. You get the URL and the keys.
            </span>
          </section>

          <section className={styles.panel}>
            <CreateCommunityForm />
          </section>

          <section className={styles.panel}>
            <h2>Prefer to do it yourself?</h2>
            <span className={styles.panelSub}>
              {platform === "unknown"
                ? "You can also install the Buzz desktop app and sign up there."
                : `You can also install the Buzz desktop app (detected ${PLATFORM_LABEL[platform]}) and sign up there.`}
            </span>
            <DownloadCta platform={platform} />
          </section>

          <section className={styles.panel}>
            <h2>Once your community exists</h2>
            <dl>
              <div>
                <dt>List it</dt>
                <dd>
                  <a href="/submit">List your community</a> so people can find
                  it.
                </dd>
              </div>
              <div>
                <dt>Link it</dt>
                <dd>
                  <a href="/shared-channels">Link it</a> with other
                  communities.
                </dd>
              </div>
            </dl>
          </section>
        </main>
      </div>
    </div>
  );
}
