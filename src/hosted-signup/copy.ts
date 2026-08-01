/**
 * User-facing copy for hosted create.
 *
 * This lives in its own module so the custody disclosure is testable. The
 * earlier wording claimed "we do not keep a copy" while `store.ts` persisted
 * AES-GCM ciphertext the host can decrypt — a false statement about the one
 * fact a person relies on when deciding whether to trust us with the key to
 * their community. `copy.test.ts` fails if that claim ever comes back.
 */
export const HOSTED_CREATE_NOTE =
  "This account can't be logged into again (its returning login needs " +
  "an email code we can't read). Save the nsec below — it is the key " +
  "to your community. BuzzRouter also keeps an encrypted copy that our " +
  "server can decrypt, so we can administer the community for you; " +
  "exporting the key lets you take control yourself.";
