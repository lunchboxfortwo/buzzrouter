import Image from "next/image";
import Link from "next/link";

import styles from "./site-chrome.module.css";

/**
 * The single masthead for every public page, rendered by the root site shell so
 * route content cannot omit the brand, navigation, canvas, or typography.
 *
 * The directory owns its own GET form elsewhere on the page (nesting forms is
 * invalid), so it passes that form's `searchFormId` and the search input
 * associates to it via the HTML `form` attribute instead of being nested.
 * Every other page gets its own form pointing back at the directory.
 */
export function SiteMasthead({
  current,
  searchDefaultValue = "",
  searchFormId,
  showSearch = false,
}: {
  current: "discover" | "shared-channels" | "submit";
  searchDefaultValue?: string;
  searchFormId?: string;
  showSearch?: boolean;
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
        form={searchFormId}
        name="q"
        placeholder="Search communities or topics"
        type="search"
      />
    </label>
  );

  return (
    <header className={styles.header}>
      <div
        className={
          showSearch
            ? styles.headerInner
            : `${styles.headerInner} ${styles.headerInnerWithoutSearch}`
        }
      >
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
            aria-current={current === "shared-channels" ? "page" : undefined}
            className={styles.navLink}
            href="/shared-channels"
          >
            Connect
          </Link>
          <Link
            aria-current={current === "submit" ? "page" : undefined}
            className={styles.navLink}
            href="/submit"
          >
            List
          </Link>
        </nav>

        {showSearch ? (
          searchFormId ? (
            search
          ) : (
            <form action="/" className={styles.searchForm} method="GET">
              {search}
            </form>
          )
        ) : null}
      </div>
    </header>
  );
}
