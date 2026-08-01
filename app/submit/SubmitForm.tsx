"use client";

import { useEffect, useRef, useState } from "react";

import { focusLabel, FOCUS_SLUGS, isFocusSlug } from "../../src/ranking/focus";
import { SUBMISSION_CATEGORY_SLUGS } from "../../src/submissions/categories";
import styles from "./submit.module.css";

interface Prefill {
  categories: string[];
  description: string | null;
  displayName: string | null;
  focus: string | null;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function SubmitForm() {
  const [relayUrl, setRelayUrl] = useState("");
  const [communityName, setCommunityName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState("");
  const [focus, setFocus] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const touchedRef = useRef({
    categories: false,
    communityName: false,
    description: false,
    focus: false,
  });

  useEffect(() => {
    const trimmed = relayUrl.trim();
    if (!trimmed) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      fetch(
        `/api/submissions/prefill?relayUrl=${encodeURIComponent(trimmed)}`,
        { signal: controller.signal },
      )
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { prefill: Prefill | null } | null) => {
          const prefill = body?.prefill;
          if (!prefill) return;
          if (!touchedRef.current.communityName && prefill.displayName) {
            setCommunityName(prefill.displayName);
          }
          if (!touchedRef.current.description && prefill.description) {
            setDescription(prefill.description);
          }
          if (!touchedRef.current.focus && prefill.focus) {
            setFocus(prefill.focus);
          }
          if (!touchedRef.current.categories && prefill.categories.length > 0) {
            setCategories(prefill.categories);
          }
        })
        .catch(() => {
          // Best-effort prefill; the submitter can always fill fields by hand.
        });
    }, 400);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [relayUrl]);

  const previewName = communityName.trim() || "Your community";
  const previewDescription = description.trim();
  const previewAudience = audience.trim();

  return (
    <>
      <section className={styles.formPanel}>
        <form action="/api/submissions" method="post">
          <label htmlFor="relay-url">Relay or invite URL</label>
          <input
            autoComplete="url"
            id="relay-url"
            maxLength={2048}
            name="relayUrl"
            onChange={(event) => setRelayUrl(event.target.value)}
            placeholder="wss://community.communities.buzz.xyz"
            required
            type="url"
            value={relayUrl}
          />

          <label htmlFor="contact-email">Contact email</label>
          <input
            autoComplete="email"
            id="contact-email"
            maxLength={254}
            name="contactEmail"
            placeholder="you@example.com"
            required
            type="email"
          />

          <label htmlFor="community-name">Community name</label>
          <input
            id="community-name"
            maxLength={80}
            name="communityName"
            onChange={(event) => {
              touchedRef.current.communityName = true;
              setCommunityName(event.target.value);
            }}
            placeholder="Buzz Builders"
            value={communityName}
          />

          <label htmlFor="description">What it does</label>
          <input
            id="description"
            maxLength={500}
            name="description"
            onChange={(event) => {
              touchedRef.current.description = true;
              setDescription(event.target.value);
            }}
            placeholder="One line describing what happens here"
            value={description}
          />

          <label htmlFor="audience">Who it&apos;s for</label>
          <input
            id="audience"
            maxLength={300}
            name="audience"
            onChange={(event) => setAudience(event.target.value)}
            placeholder="Who joins, and what they get out of it"
            value={audience}
          />

          <label htmlFor="focus">Focus (optional)</label>
          <select
            id="focus"
            name="focus"
            onChange={(event) => {
              touchedRef.current.focus = true;
              setFocus(event.target.value);
            }}
            value={focus}
          >
            <option value="">No focus selected</option>
            {FOCUS_SLUGS.map((slug) => (
              <option key={slug} value={slug}>
                {focusLabel(slug)}
              </option>
            ))}
          </select>

          <fieldset className={styles.categoryFieldset}>
            <legend>Categories (optional)</legend>
            {SUBMISSION_CATEGORY_SLUGS.map((slug) => (
              <label className={styles.categoryOption} key={slug}>
                <input
                  checked={categories.includes(slug)}
                  name="categories"
                  onChange={(event) => {
                    touchedRef.current.categories = true;
                    setCategories((current) =>
                      event.target.checked
                        ? [...current, slug]
                        : current.filter((value) => value !== slug),
                    );
                  }}
                  type="checkbox"
                  value={slug}
                />
                {capitalize(slug)}
              </label>
            ))}
          </fieldset>

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

        <p className={styles.policyNote}>
          The listing publishes only after direct relay verification
          succeeds, and any invite code you include is used only to hand
          members to the Buzz app.
        </p>
      </section>

      <section className={styles.preview} aria-label="Listing preview">
        <span className={styles.previewLabel}>What your listing will look like</span>
        <div className={styles.previewCard}>
          <strong>{previewName}</strong>
          {focus && isFocusSlug(focus) ? (
            <span className={styles.previewFocus}>{focusLabel(focus)}</span>
          ) : null}
          <p>{previewDescription || "Add a one-line description above."}</p>
          {previewAudience ? (
            <p className={styles.previewAudience}>{previewAudience}</p>
          ) : null}
          {categories.length > 0 ? (
            <div className={styles.previewTags}>
              {categories.map((category) => (
                <span className={styles.previewTag} key={category}>
                  {category}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
