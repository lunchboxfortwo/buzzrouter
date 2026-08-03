import type { ReactNode } from "react";

import styles from "./shared-channels.module.css";

const stages = [
  { title: "Paste invite", detail: "Owner or admin" },
  { title: "Bridge joins", detail: "One community" },
  { title: "Pick channel", detail: "From your relay" },
  { title: "Hub opens", detail: "Send and receive on" },
  { title: "Messages fan out", detail: "Per-relay outcomes" },
] as const;

export function SharedChannelFlow() {
  return (
    <figure
      aria-labelledby="shared-channel-flow-title"
      className={styles.flow}
    >
      <figcaption className={styles.flowHeading}>
        <h2 id="shared-channel-flow-title">One link. Every hub community.</h2>
        <span>No proposal, acceptance, or confirmation code.</span>
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
              Loading channels…
            </span>
            <span className={styles.channelActionAfter}># general selected</span>
          </div>
          <div className={`${styles.chatMessage} ${styles.outboundMessage}`}>
            Hey Orange Magic team, could you send us video ad copy for
            tomorrow&apos;s product launch?
          </div>
          <div className={`${styles.chatMessage} ${styles.mirroredMessage}`}>
            <strong>Franz · Orange Magic [via BuzzRouter]</strong>
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
          <div className={styles.proposalCard}>Open channel joined</div>
          <div className={styles.armedBadge}>Send + receive on</div>
          <div className={styles.verifiedBadge}>
            <CheckIcon /> Relay delivered · live
          </div>
        </div>

        <CommunityPanel
          admissionLabel="Bot joined"
          initial="O"
          name="Orange Magic"
        >
          <div className={styles.channelName}># launch-collab</div>
          <div className={styles.codeBubble}><span>Hub</span>Linked</div>
          <div className={`${styles.chatMessage} ${styles.replyMessage}`}>
            <strong>Franz</strong>
            Sure, give me a couple of hours
          </div>
        </CommunityPanel>
      </div>

      <div aria-hidden="true" className={styles.staticScene}>
        <div>
          <strong>Invite accepted</strong>
          <span>Your bridge joins the relay ✓</span>
        </div>
        <div>
          <strong>Bridge online</strong>
          <span>Channels loaded from your relay</span>
        </div>
        <div>
          <strong>Channel picked</strong>
          <span># launch-collab</span>
        </div>
        <div>
          <strong>Hub joined</strong>
          <span>Send + receive on ✓</span>
        </div>
        <div>
          <strong>Delivered</strong>
          <span>Franz · Orange Magic [via BuzzRouter] · Sure, give me a couple of hours</span>
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
