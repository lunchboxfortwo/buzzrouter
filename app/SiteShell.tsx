"use client";

import { Suspense, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { SiteMasthead } from "./SiteMasthead";
import chrome from "./site-chrome.module.css";

type SiteSection = "discover" | "shared-channels" | "submit";

function sectionForPath(pathname: string): SiteSection {
  if (pathname.startsWith("/shared-channels")) return "shared-channels";
  if (pathname.startsWith("/submit")) return "submit";
  return "discover";
}

function SearchAwareMasthead({
  current,
  showSearch,
}: {
  current: SiteSection;
  showSearch: boolean;
}) {
  const searchParams = useSearchParams();
  const search = (searchParams.get("q") ?? "").trim().slice(0, 100);

  return (
    <SiteMasthead
      current={current}
      searchDefaultValue={search}
      searchFormId={showSearch ? "directory-filters" : undefined}
      showSearch={showSearch}
    />
  );
}

/**
 * Structural chrome for every public route. Internal tools are deliberately
 * excluded so their dense operational UI can keep its own shell.
 */
export function SiteShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  if (pathname.startsWith("/internal/")) {
    return children;
  }

  const current = sectionForPath(pathname);
  const showSearch = pathname === "/";

  return (
    <div className={chrome.siteCanvas}>
      <Suspense
        fallback={<SiteMasthead current={current} />}
      >
        <SearchAwareMasthead current={current} showSearch={showSearch} />
      </Suspense>
      {children}
    </div>
  );
}
