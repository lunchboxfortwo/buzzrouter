import type { FocusSlug } from "./focus";

/**
 * Focus cannot be observed at the relay: NIP-11 carries no topic, and nearly
 * every Buzz relay publishes the same generic description. What signal exists
 * lives in the hostname, in the public code that references the relay, and in
 * the rare relay that writes its own description.
 *
 * This classifier is deliberately high precision and low coverage. A wrong
 * category is worse than none — it is invisible to us and misleads the reader
 * silently — so anything ambiguous stays unset and waits for a human.
 */

interface Keyword {
  focus: FocusSlug;
  /** Specific terms outweigh generic ones when a name matches several. */
  weight: number;
  word: string;
}

const KEYWORDS: Keyword[] = [
  ...asKeywords("bitcoin-money", 3, [
    "bitcoin",
    "bitcoiners",
    "btc",
    "sats",
    "lightning",
    "cashu",
    "ecash",
    "fintech",
    "payments",
  ]),
  ...asKeywords("bitcoin-money", 2, ["banking", "wallet", "finance", "money"]),

  ...asKeywords("ai-agents", 3, [
    "agent",
    "agents",
    "llm",
    "gpt",
    "claude",
    "devin",
    "prompt",
    "inference",
    "openai",
    "anthropic",
  ]),
  ...asKeywords("ai-agents", 2, ["ai", "ml"]),

  ...asKeywords("design-creative", 3, [
    "design",
    "designers",
    "creative",
    "creator",
    "music",
    "audio",
    "video",
    "photo",
    "art",
  ]),
  ...asKeywords("design-creative", 2, ["studio", "story", "writing"]),

  ...asKeywords("building", 3, [
    "builders",
    "developers",
    "engineering",
    "opensource",
    "hackers",
    "vim",
    "emacs",
    "rust",
    "golang",
    "typescript",
  ]),
  ...asKeywords("building", 2, ["dev", "devs", "code", "coding", "build"]),

  ...asKeywords("research-knowledge", 3, [
    "research",
    "science",
    "papers",
    "academic",
    "dataset",
    "datasets",
  ]),
  ...asKeywords("research-knowledge", 2, ["learn", "knowledge"]),

  ...asKeywords("local-regional", 3, [
    "nyc",
    "sf",
    "london",
    "berlin",
    "tokyo",
    "paris",
    "lisbon",
    "galicia",
    "brasil",
    "brazil",
    "india",
    "korea",
    "latam",
    "japan",
  ]),

  ...asKeywords("team-private", 3, ["internal", "staff", "hq"]),
  ...asKeywords("team-private", 2, ["team", "company"]),
];

function asKeywords(
  focus: FocusSlug,
  weight: number,
  words: string[],
): Keyword[] {
  return words.map((word) => ({ focus, weight, word }));
}

/** The default Buzz relays publish, which carries no topical signal at all. */
const GENERIC_DESCRIPTION = /private team communication relay|^buzz\b[\s.]*$/i;

const MIN_COMPOUND_MATCH = 4;

export interface FocusClassificationInput {
  description?: string | null;
  githubLocators?: string[];
  host: string;
}

export interface FocusClassification {
  focus: FocusSlug;
  matched: string[];
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * A hostname like "audiodev" never splits into tokens, so a keyword may only
 * appear as a substring. Requiring four characters keeps short words such as
 * "ai" or "sf" from matching inside unrelated names.
 */
function matches(token: string, word: string): boolean {
  if (token === word) return true;
  return word.length >= MIN_COMPOUND_MATCH && token.includes(word);
}

export function classifyFocus(
  input: FocusClassificationInput,
): FocusClassification | null {
  const hostTokens = tokenize(input.host.split(".")[0] ?? "");

  const description = (input.description ?? "").trim();
  const descriptionTokens = GENERIC_DESCRIPTION.test(description)
    ? []
    : tokenize(description);

  const locatorTokens = (input.githubLocators ?? []).flatMap((locator) =>
    tokenize(locator).filter(
      (token) => !["https", "github", "com", "blob", "main", "master"].includes(token),
    ),
  );

  const scores = new Map<FocusSlug, number>();
  const matched: string[] = [];

  const consider = (tokens: string[], multiplier: number): void => {
    for (const token of tokens) {
      // Overlapping keywords ("builders" also contains "build") must not let a
      // single word count twice for the same focus.
      const best = new Map<FocusSlug, Keyword>();
      for (const keyword of KEYWORDS) {
        if (!matches(token, keyword.word)) continue;
        const incumbent = best.get(keyword.focus);
        if (!incumbent || keyword.weight > incumbent.weight) {
          best.set(keyword.focus, keyword);
        }
      }

      for (const keyword of best.values()) {
        scores.set(
          keyword.focus,
          (scores.get(keyword.focus) ?? 0) + keyword.weight * multiplier,
        );
        matched.push(keyword.word);
      }
    }
  };

  // The hostname is the community's own chosen name; borrowed context counts
  // for less.
  consider(hostTokens, 3);
  consider(descriptionTokens, 2);
  consider(locatorTokens, 1);

  if (scores.size === 0) return null;

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [topFocus, topScore] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;

  // A name pulling two ways ("devin-builders") is genuinely ambiguous; leave it
  // for review rather than guessing between them.
  if (topScore <= runnerUp) return null;

  return { focus: topFocus, matched: [...new Set(matched)] };
}
