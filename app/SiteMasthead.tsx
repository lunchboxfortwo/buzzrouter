import Image from "next/image";
import Link from "next/link";

import styles from "./site-chrome.module.css";

/**
 * The single masthead for every public page. Both routes render this so the
 * brand, routes, active-state colour, and search field cannot drift apart.
 *
 * The directory already wraps its content in a GET form, and nesting forms is
 * invalid, so it passes `searchInForm` and lets the parent own submission.
 * Every other page gets its own form pointing back at the directory.
 */
export function SiteMasthead({
  current,
  searchDefaultValue = "",
  searchInForm = false,
}: {
  current: "create" | "discover" | "shared-channels" | "submit";
  searchDefaultValue?: string;
  searchInForm?: boolean;
}) {
  const search = (
    <label className={styles.searchField}>
      <span className={styles.visuallyHidden}>Search communities</span>
      <svg aria-hidden="true" className={styles.searchIcon} viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4" />
      </svg>
      <input
        className={styles.searchInput}
        defaultValue={searchDefaultValue}
        name="q"
        placeholder="Search communities or topics"
        type="search"
      />
    </label>
  );

  return (
    <header className={styles.header}>
      <div className={styles.headerInner}>
        <Link aria-label="BuzzRouter directory" className={styles.brand} href="/">
          <Image
            alt=""
            className={styles.logo}
            height={34}
            priority
            src="/assets/brand/buzzrouter-logo.png"
            width={34}
          />
          <span>BuzzRouter</span>
        </Link>

        <nav aria-label="Primary navigation" className={styles.nav}>
          <Link
            aria-current={current === "discover" ? "page" : undefined}
            className={styles.navLink}
            href="/"
          >
            Discover
          </Link>
          <Link
            aria-current={current === "create" ? "page" : undefined}
            className={styles.navLink}
            href="/create-community"
          >
            Create a community
          </Link>
          <Link
            aria-current={current === "shared-channels" ? "page" : undefined}
            className={styles.navLink}
            href="/shared-channels"
          >
            Shared channels
          </Link>
          <Link
            aria-current={current === "submit" ? "page" : undefined}
            className={styles.navLink}
            href="/submit"
          >
            List a community
          </Link>
        </nav>

        {searchInForm ? (
          search
        ) : (
          <form action="/" className={styles.searchForm} method="GET">
            {search}
          </form>
        )}
      </div>
    </header>
  );
}
