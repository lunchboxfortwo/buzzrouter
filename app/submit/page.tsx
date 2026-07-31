import Image from "next/image";

import styles from "./submit.module.css";

interface SubmitSearchParams {
  host?: string | string[];
  status?: string | string[];
}

export default async function SubmitPage({
  searchParams,
}: {
  searchParams: Promise<SubmitSearchParams>;
}) {
  const params = await searchParams;
  const status = firstValue(params.status);
  const host = firstValue(params.host);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <a className={styles.brand} href="/">
            <Image
              alt=""
              height={34}
              priority
              src="/assets/brand/buzzrouter-logo.png"
              width={34}
            />
            <span>BuzzRouter</span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="/">Discover</a>
            <a aria-current="page" href="/submit">
              List a community
            </a>
          </nav>
        </div>
      </header>

      <main>
        <section className={styles.intro}>
          <p>Community intake</p>
          <h1>Submit a Buzz community</h1>
          <span>
            Add a relay or shared invite URL. The listing appears only after
            direct Buzz protocol verification succeeds.
          </span>
        </section>

        <section className={styles.formPanel}>
          {status === "queued" ? (
            <div className={styles.success} role="status">
              <strong>Verification queued</strong>
              <span>
                {host
                  ? `${host} is now in the verification pipeline.`
                  : "The community is now in the verification pipeline."}
              </span>
            </div>
          ) : null}
          {status === "invalid" ? (
            <div className={styles.error} role="alert">
              Enter a valid public relay or Buzz invite URL.
            </div>
          ) : null}
          {status === "failed" ? (
            <div className={styles.error} role="alert">
              The submission could not be queued. Try again shortly.
            </div>
          ) : null}

          <form action="/api/submissions" method="post">
            <label htmlFor="relay-url">Relay or invite URL</label>
            <input
              autoComplete="url"
              id="relay-url"
              maxLength={2048}
              name="relayUrl"
              placeholder="wss://community.communities.buzz.xyz"
              required
              type="url"
            />
            <div className={styles.honeypot} aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                autoComplete="off"
                id="website"
                name="website"
                tabIndex={-1}
                type="text"
              />
            </div>
            <button type="submit">Queue verification</button>
          </form>

          <dl>
            <div>
              <dt>Accepted</dt>
              <dd>WSS relay, HTTPS community, or shared invite URL</dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>Only after a fresh direct relay verification</dd>
            </div>
            <div>
              <dt>Private data</dt>
              <dd>Invite paths and tokens are discarded before storage</dd>
            </div>
          </dl>
        </section>
      </main>
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
