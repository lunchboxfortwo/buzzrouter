"use client";

import { launchJoin, type JoinTarget } from "./joinCascade";
import { hostFromRelayUrl, trackJoinClick } from "./track";

/**
 * The one-tap Join affordance on a joinable directory row. It sits above the
 * row's stretched overlay link (higher stacking + its own pointer events), so a
 * tap here opens the community's join flow while a tap anywhere else on the row
 * opens the card. `stopPropagation` is belt-and-suspenders in case the overlay
 * ever becomes an ancestor.
 */
export function RowJoinButton({
  className,
  communityName,
  joinTarget,
}: {
  className: string;
  communityName: string;
  joinTarget: JoinTarget;
}) {
  return (
    <button
      aria-label={`Join ${communityName}`}
      className={className}
      onClick={(event) => {
        event.stopPropagation();
        trackJoinClick({
          affordance: "row_join",
          candidateId: joinTarget.candidateId ?? null,
          host: hostFromRelayUrl(joinTarget.relayUrl),
        });
        launchJoin(joinTarget);
      }}
      type="button"
    >
      Join
    </button>
  );
}
