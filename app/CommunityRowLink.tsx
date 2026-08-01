import Link from "next/link";

/**
 * The row's tap target: a stretched overlay link (positioned to fill the row)
 * that selects the community and opens its card. On mobile the card is sticky at
 * the top of the viewport, so it updates in place — no scroll handling needed.
 * `scroll={false}` keeps navigation from jumping the page to the top.
 *
 * Joining is handled separately by RowJoinButton, which sits above this overlay
 * with its own pointer events: a tap there joins, a tap anywhere else opens the
 * card.
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
      scroll={false}
    />
  );
}
