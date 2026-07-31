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
            <p>Create a community</p>
            <h1>Start a Buzz community</h1>
            <span>
              Buzz communities are free and hosted by Block. Sign up on the
              hosted service to create one — buzz.xyz doesn&apos;t have a
              signup path today, so this goes straight there.
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
            <span className={styles.primaryLinkNote}>
              That link redirects into Block&apos;s Auth0 sign-in flow.
            </span>
          </section>

          <section className={styles.panel}>
            <h2>Before you sign up</h2>
            <p>
              Creating a community currently requires the Buzz desktop app.
              It&apos;s about 134MB to install, and downloads roughly another
              577MB of models the first time you run it. During setup, Buzz
              generates a Nostr key for you and stores it locally on your
              device — that key is what identifies your community and lets
              members find it.
            </p>
            <p>
              We&apos;re looking into whether that install step can be
              skipped, but for now it&apos;s the only path, so plan for the
              download before you start.
            </p>
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
                <dt>List it here</dt>
                <dd>
                  <a href="/submit">Submit your community</a> to the
                  BuzzRouter directory so people can find it.
                </dd>
              </div>
              <div>
                <dt>Connect it</dt>
                <dd>
                  <a href="/shared-channels">Set up shared channels</a> to
                  bridge it with other communities.
                </dd>
              </div>
            </dl>
            <p>
              Once listed, it's also reachable by other developers through
              the directory's public{" "}
              <a href="/api/communities?joinable=true">
                GET /api/communities
              </a>{" "}
              API.
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}
