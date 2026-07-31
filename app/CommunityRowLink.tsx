"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import {
  hasJoinTarget,
  launchJoin,
  type JoinTarget,
} from "./joinCascade";

const MOBILE = "(max-width: 920px)";

/**
 * Desktop keeps the row as navigation into the inspector. On a phone the tap
 * goes straight into the join cascade — the Buzz app when the community has
 * an invite code, its public page otherwise. Rows with no join target keep
 * navigating to the inspector on every viewport.
 */
export function CommunityRowLink({
  ariaCurrent,
  children,
  className,
  href,
  joinTarget,
}: {
  ariaCurrent?: "true";
  children: ReactNode;
  className: string;
  href: string;
  joinTarget: JoinTarget;
}) {
  return (
    <Link
      aria-current={ariaCurrent}
      className={className}
      href={href}
      onClick={(event) => {
        if (!window.matchMedia(MOBILE).matches) return;
        if (!hasJoinTarget(joinTarget)) return;
        event.preventDefault();
        launchJoin(joinTarget);
      }}
      scroll={false}
    >
      {children}
    </Link>
  );
}
