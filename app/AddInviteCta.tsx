import styles from "./AddInviteCta.module.css";

/**
 * Owner-facing "add an invite" call to action, scoped to one community. It posts
 * the pasted invite link to the shared `/api/submissions` endpoint, which
 * validates it synchronously (the worker joins with it) before listing. The
 * hidden `expectHost` pins the submission to THIS community so an invite for a
 * different one is rejected. `variant` controls prominence: `prominent` on a
 * keyless community's profile (its main action), `quiet` where a working invite
 * already exists (a modest "keep it fresh" affordance). Plain HTML form — no
 * client JS.
 */
export function AddInviteCta({
  host,
  variant = "prominent",
}: {
  host: string;
  variant?: "prominent" | "quiet";
}) {
  const prominent = variant === "prominent";
  return (
    <form
      action="/api/submissions"
      className={`${styles.card} ${prominent ? styles.prominent : styles.quiet}`}
      method="post"
    >
      <p className={styles.head}>Run this community?</p>
      <p className={styles.sub}>
        {prominent
          ? "Add an invite link so people can find and join it from here — we verify it on the spot."
          : "Keep the invite people join with fresh — paste a new link and we verify it on the spot."}
      </p>
      <div className={styles.row}>
        <input
          aria-label="Invite link"
          className={styles.input}
          name="relayUrl"
          placeholder={`https://${host}/invite/…`}
          required
          type="url"
        />
        <button className={styles.button} type="submit">
          {prominent ? "Add invite" : "Update"}
        </button>
      </div>
      <input name="expectHost" type="hidden" value={host} />
      <div aria-hidden="true" className={styles.honeypot}>
        <input autoComplete="off" name="website" tabIndex={-1} type="text" />
      </div>
    </form>
  );
}
