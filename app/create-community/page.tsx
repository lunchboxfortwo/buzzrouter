import { headers } from "next/headers";

import chrome from "../site-chrome.module.css";
import { SiteMasthead } from "../SiteMasthead";

import styles from "./create-community.module.css";
import { DownloadCta } from "./DownloadCta";
import { detectPlatform } from "./platform";

const HOSTED_SIGNUP_URL = "https://app.builderlab.xyz";

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
            <h1>Start a Buzz community</h1>
            <span>
              Heads up: this needs the Buzz desktop app — about 134MB to
              install, plus roughly 577MB of models the first time you run it.
            </span>
          </section>

          <section className={styles.panel}>
            <a
              className={styles.primaryLink}
              href={HOSTED_SIGNUP_URL}
              rel="noopener noreferrer"
              target="_blank"
            >
              Sign up at app.builderlab.xyz
              <svg aria-hidden="true" viewBox="0 0 24 24">
                <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
              </svg>
            </a>
          </section>

          <section className={styles.panel}>
            <h2>Get Buzz for your computer</h2>
            <span className={styles.panelSub}>
              {platform === "unknown"
                ? "We couldn't detect your platform automatically — pick yours below."
                : `Detected ${PLATFORM_LABEL[platform]}. Wrong platform? Pick another below.`}
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
