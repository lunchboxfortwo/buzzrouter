"use client";

import Link from "next/link";

const MOBILE = "(max-width: 920px)";

/**
 * The row's tap target: a stretched overlay link (positioned to fill the row)
 * that selects the community and opens its card. On a phone the card is pinned
 * at the top of the results, so we scroll it into view after selecting —
 * otherwise the card updates off-screen and the tap feels like nothing happened.
 *
 * Joining is NOT triggered here anymore: every row now opens the card first, and
 * an explicit Join button (see RowJoinButton) handles the one-tap join. That
 * button sits above this overlay with its own pointer events, so a tap on it
 * joins while a tap anywhere else on the row opens the card.
 */
export function CommunityRowLink({
  ariaLabel,
  className,
  href,
}: {
  ariaLabel: string;
  className: string;
  href: string;
}) {
  return (
    <Link
      aria-label={ariaLabel}
      className={className}
      href={href}
      onClick={() => {
        if (window.matchMedia(MOBILE).matches) {
          requestAnimationFrame(() => {
            document
              .getElementById("community-card")
              ?.scrollIntoView({ behavior: "smooth", block: "start" });
          });
        }
      }}
      scroll={false}
    />
  );
}
