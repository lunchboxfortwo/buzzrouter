"use client";

import { useEffect, useState, type ReactNode } from "react";

import styles from "./site-chrome.module.css";

const DESKTOP = "(min-width: 921px)";

/**
 * Expanded on desktop, where there is room, and collapsed on a phone, where
 * the selected community has to stay reachable while the reader scrolls the
 * list beneath it.
 *
 * Server-rendered open so the content is present for readers without
 * JavaScript and for search engines; it collapses on narrow viewports after
 * hydration.
 */
export function MobileCollapsible({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const query = window.matchMedia(DESKTOP);
    const sync = () => setOpen(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return (
    <div className={styles.collapsible}>
      <button
        aria-expanded={open}
        className={styles.collapsibleToggle}
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        {open ? `Hide ${label.toLowerCase()}` : label}
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {open ? children : null}
    </div>
  );
}
