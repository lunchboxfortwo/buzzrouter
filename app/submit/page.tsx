
import { SubmitForm } from "./SubmitForm";
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

      <main>
        <section className={styles.intro}>
          <p>Community intake</p>
          <h1>Submit a Buzz community</h1>
          <span>
            Tell us what your community does and who it&apos;s for. We&apos;ll
            use it to build your listing once the relay verifies.
          </span>
        </section>

        <div className={styles.statusMessages}>
          {status === "queued" ? (
            <div className={styles.success} role="status">
              <strong>Verification queued</strong>
              <span>
                {host
                  ? `${host} is now in the verification pipeline.`
                  : "The community is now in the verification pipeline."}
              </span>
              <span>
                Once verification succeeds, open{" "}
                <a href="/shared-channels#invite-link">Connect</a> and paste an
                owner/admin invite from your community.
              </span>
            </div>
          ) : null}
          {status === "invalid" ? (
            <div className={styles.error} role="alert">
              Enter a valid public relay or Buzz invite URL, and a contact
              email we can reach you at.
            </div>
          ) : null}
          {status === "failed" ? (
            <div className={styles.error} role="alert">
              The submission could not be queued. Try again shortly.
            </div>
          ) : null}
          {status === "verified" ? (
            <div className={styles.success} role="status">
              <strong>Verified — your invite works</strong>
              <span>
                {host
                  ? `${host} is now listed and joinable, and our agent is in.`
                  : "The community is now listed and joinable."}
              </span>
            </div>
          ) : null}
          {status === "verifying" ? (
            <div className={styles.success} role="status">
              <strong>Verifying your invite…</strong>
              <span>
                This is taking a moment. Your listing will appear shortly once
                the invite is confirmed — no need to resubmit.
              </span>
            </div>
          ) : null}
          {status === "invite_invalid" ? (
            <div className={styles.error} role="alert">
              That invite didn&rsquo;t work — it may be expired, single-use, or
              for a different community. Mint a fresh one in Buzz and try again.
            </div>
          ) : null}
          {status === "rate_limited" ? (
            <div className={styles.error} role="alert">
              Too many submissions from your connection. Wait a minute and try
              again.
            </div>
          ) : null}
        </div>

        <div className={styles.formLayout}>
          <SubmitForm />
        </div>
      </main>
    </div>
  );
}

function firstValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}
