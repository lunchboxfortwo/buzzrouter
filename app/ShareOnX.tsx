/**
 * Opens X's compose window pre-filled with the community and its BuzzRouter
 * link. Uses the web-intent URL, so it needs no API, auth, or client code —
 * and the shared link renders the community's social card.
 */
export function ShareOnX({
  className,
  text,
  url,
}: {
  className?: string;
  text: string;
  url: string;
}) {
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
  return (
    <a
      className={className}
      href={intent}
      rel="noopener noreferrer"
      target="_blank"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M18.9 2H22l-7 8 8.2 12h-6.4l-5-7.3L6 22H2.9l7.5-8.6L2 2h6.6l4.6 6.7L18.9 2Zm-1.1 18h1.8L7.2 4H5.3l12.5 16Z" />
      </svg>
      Share on X
    </a>
  );
}
