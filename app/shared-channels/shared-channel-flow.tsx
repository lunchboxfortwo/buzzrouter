import type { ReactNode } from "react";

import styles from "./shared-channels.module.css";

const stages = [
  { title: "Admit both bots", detail: "Two invite links" },
  { title: "Propose", detail: "Choose channels" },
  { title: "Accept arms", detail: "Not live yet" },
  { title: "Code verifies", detail: "Owner or admin" },
  { title: "Messages mirror", detail: "Both ways" },
] as const;

export function SharedChannelFlow() {
  return (
    <figure
      aria-labelledby="shared-channel-flow-title"
      className={styles.flow}
    >
      <figcaption className={styles.flowHeading}>
        <h2 id="shared-channel-flow-title">Two communities. One verified link.</h2>
        <span>Accepting is not enough—the channel code makes it live.</span>
      </figcaption>

      <ol className={styles.flowSteps}>
        {stages.map((stage) => (
          <li className={styles.flowStep} key={stage.title}>
            <span>{stage.title}</span>
            <small>{stage.detail}</small>
          </li>
        ))}
      </ol>

      <div aria-hidden="true" className={styles.motionScene}>
        <CommunityPanel
          admissionLabel="Bot joined"
          initial="Y"
          name="Your team"
        >
          <div className={styles.channelAction}>
            <span className={styles.channelActionBefore}>
              + Create a new channel
            </span>
            <span className={styles.channelActionAfter}># launch-collab</span>
          </div>
          <div className={`${styles.chatMessage} ${styles.outboundMessage}`}>
            Hey Orange Magic team, could you send us video ad copy for
            tomorrow&apos;s product launch?
          </div>
          <div className={`${styles.chatMessage} ${styles.mirroredMessage}`}>
            <strong>Franz - OrangeMagic</strong>
            Sure, give me a couple of hours
          </div>
        </CommunityPanel>

        <div className={styles.bridgeLane}>
          <div className={styles.bridgeIdentity}>
            <img
              alt=""
              height="32"
              src="/assets/brand/buzzrouter-logo.png"
              width="32"
            />
            <strong>BuzzRouter</strong>
          </div>
          <div className={styles.routeLine} />
          <div className={styles.proposalCard}>Shared channel proposed</div>
          <div className={styles.armedBadge}>Armed · waiting for code</div>
          <div className={styles.verifiedBadge}>
            <CheckIcon /> Roster verified · live
          </div>
        </div>

        <CommunityPanel
          admissionLabel="Bot joined"
          initial="O"
          name="Orange Magic"
        >
          <div className={styles.channelName}># launch-collab</div>
          <div className={styles.codeBubble}>
            <span>Owner</span>
            BRIDGE-7K4M
          </div>
          <div className={`${styles.chatMessage} ${styles.replyMessage}`}>
            <strong>Franz</strong>
            Sure, give me a couple of hours
          </div>
        </CommunityPanel>
      </div>

      <div aria-hidden="true" className={styles.staticScene}>
        <div>
          <strong>Both admitted</strong>
          <span>Your team ✓&nbsp;&nbsp; Orange Magic ✓</span>
        </div>
        <div>
          <strong>Proposed</strong>
          <span>Your team → Orange Magic</span>
        </div>
        <div>
          <strong>Accepted</strong>
          <span>Armed · not live</span>
        </div>
        <div>
          <strong>Code sent</strong>
          <span>Owner/admin → roster verified ✓</span>
        </div>
        <div>
          <strong>Live both ways</strong>
          <span>Franz - OrangeMagic · Sure, give me a couple of hours</span>
        </div>
      </div>
    </figure>
  );
}

function CommunityPanel({
  admissionLabel,
  children,
  initial,
  name,
}: {
  admissionLabel: string;
  children: ReactNode;
  initial: string;
  name: string;
}) {
  return (
    <section className={styles.communityPanel}>
      <header>
        <span className={styles.communityMark}>{initial}</span>
        <strong>{name}</strong>
      </header>
      <div className={styles.inviteStatus}>
        <CheckIcon /> {admissionLabel}
      </div>
      <div className={styles.channelWindow}>{children}</div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m3.25 8.25 3 3 6.5-6.5" />
    </svg>
  );
}
