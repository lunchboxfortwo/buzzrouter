import type { PresenceMessage } from "./reader";

/**
 * Summarizes a Buzz community FOR A PROSPECTIVE MEMBER browsing the directory
 * and deciding whether to join. The summary surfaces exactly three things:
 *
 *   1. goals          — what the community is about / its overall purpose.
 *   2. recentProjects — 2–4 short bullets on what it's recently working on.
 *   3. activity       — how active it is, including a count of active members.
 *
 * Only `goals` and `recentProjects` come from the LLM. Every count
 * (activeMemberCount, messageCount, channelCount) and the derived activityLevel
 * are computed DETERMINISTICALLY here from the message set — never asked of the
 * model — so the directory's activity claims are auditable and stable.
 */

const DEFAULT_OPENROUTER_ORIGIN = "https://openrouter.ai";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const DEFAULT_WINDOW_DAYS = 7;
const SECONDS_PER_DAY = 86_400;
/** Cap the outbound prompt so a busy community can't blow the context window. */
const MAX_PROMPT_MESSAGES = 200;

export type ActivityLevel = "quiet" | "light" | "active" | "busy";

export interface CommunitySummary {
  goals: string;
  recentProjects: string[];
  activityLevel: ActivityLevel;
  activeMemberCount: number;
  totalMemberCount?: number;
  messageCount: number;
  channelCount: number;
  windowDays: number;
}

/** The two fields the LLM produces; everything else is computed in code. */
export interface CommunityBlurb {
  goals: string;
  recentProjects: string[];
}

export interface ActivityMetrics {
  activeMemberCount: number;
  messageCount: number;
  channelCount: number;
  activityLevel: ActivityLevel;
  windowDays: number;
}

export interface MetricsOptions {
  /** Reference time (seconds) the window is measured back from; defaults now. */
  now?: number;
  windowDays?: number;
}

export interface SummarizeOptions extends MetricsOptions {
  apiKey?: string;
  model?: string;
  /**
   * Origin the OpenRouter-compatible endpoint is built from; the request is
   * POSTed to `${baseUrl}/api/v1/chat/completions`. Defaults to
   * `OPENROUTER_BASE_URL` then `https://openrouter.ai`. Point this at the Squire
   * egress proxy to have the real key injected at the boundary.
   */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface BuildSummaryOptions extends SummarizeOptions {
  /** Optional NIP-29 roster size (distinct members across the community). */
  totalMemberCount?: number;
}

/**
 * Filters `messages` to the trailing `windowDays` window (relative to `now`).
 * Both edges use the same reference so metric and prompt inputs agree.
 */
export function messagesInWindow(
  messages: PresenceMessage[],
  options: MetricsOptions = {},
): PresenceMessage[] {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const now = options.now ?? Math.floor(Date.now() / 1_000);
  const cutoff = now - windowDays * SECONDS_PER_DAY;
  return messages.filter((message) => message.createdAt >= cutoff);
}

/**
 * Derives the coarse activity level from the windowed message volume and the
 * number of distinct active members. Thresholds (per window, default 7 days):
 *
 *   quiet  — no messages at all.
 *   light  — under 10 messages, or only a single active member.
 *   active — 10–49 messages with at least a couple of active members.
 *   busy   — 50+ messages AND 5+ active members.
 */
export function deriveActivityLevel(
  messageCount: number,
  activeMemberCount: number,
): ActivityLevel {
  if (messageCount === 0) return "quiet";
  if (messageCount < 10 || activeMemberCount <= 1) return "light";
  if (messageCount >= 50 && activeMemberCount >= 5) return "busy";
  return "active";
}

/**
 * Computes the deterministic activity metrics over the trailing window:
 * distinct authors (activeMemberCount), message volume, and distinct channels.
 */
export function computeActivityMetrics(
  messages: PresenceMessage[],
  options: MetricsOptions = {},
): ActivityMetrics {
  const windowDays = options.windowDays ?? DEFAULT_WINDOW_DAYS;
  const windowed = messagesInWindow(messages, { ...options, windowDays });
  const pubkeys = new Set<string>();
  const channels = new Set<string>();
  for (const message of windowed) {
    pubkeys.add(message.pubkey);
    channels.add(message.channelId);
  }
  const messageCount = windowed.length;
  const activeMemberCount = pubkeys.size;
  return {
    activeMemberCount,
    activityLevel: deriveActivityLevel(messageCount, activeMemberCount),
    channelCount: channels.size,
    messageCount,
    windowDays,
  };
}

const SYSTEM_PROMPT = [
  "You write neutral, public-facing blurbs for a community directory.",
  "Your reader is a prospective member deciding whether to JOIN this community.",
  "You are given recent public messages, each with a channel, content, and",
  "timestamp — nothing that identifies who wrote them.",
  "Produce a JSON object with exactly two fields:",
  '  "goals": a 1-2 sentence description of what the community is about and its',
  "    overall purpose.",
  '  "recentProjects": an array of 2-4 short strings, each a single interesting',
  "    thing the community has recently been working on or discussing.",
  "Rules: Write for an outsider. Do NOT include usernames, display names,",
  "pubkeys, npubs, or any IDs. Do NOT quote messages verbatim — paraphrase.",
  "Do NOT invent facts not supported by the messages. If there is too little",
  'activity to tell, say so plainly in "goals" and return an empty',
  '"recentProjects" array. Respond with ONLY the JSON object.',
].join("\n");

/**
 * The LLM half of the summary. Strips every pubkey before the messages leave
 * the process — the model sees only channel, content, and timestamp. Returns
 * the paraphrased `{ goals, recentProjects }` blurb.
 *
 * Requires `OPENROUTER_API_KEY` (or an injected `apiKey`); the key is never
 * logged. Model defaults to `OPENROUTER_MODEL` or `deepseek/deepseek-v4-flash`.
 */
export async function summarizeMessages(
  messages: PresenceMessage[],
  options: SummarizeOptions = {},
): Promise<CommunityBlurb> {
  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      "OPENROUTER_API_KEY is required to summarize community activity.",
    );
  }
  const model =
    options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  // Strip pubkeys: the model only ever sees channel + content + timestamp.
  const redacted = messages.slice(-MAX_PROMPT_MESSAGES).map((message) => ({
    channel: message.channelId,
    content: message.content,
    timestamp: message.createdAt,
  }));

  const requestBody = JSON.stringify({
    messages: [
      { content: SYSTEM_PROMPT, role: "system" },
      { content: JSON.stringify(redacted), role: "user" },
    ],
    model,
    response_format: { type: "json_object" },
  });

  const origin =
    options.baseUrl ??
    process.env.OPENROUTER_BASE_URL ??
    DEFAULT_OPENROUTER_ORIGIN;
  const url = `${origin}/api/v1/chat/completions`;

  const response = await fetchImpl(url, {
    body: requestBody,
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
  if (!response.ok) {
    throw new Error(
      `OpenRouter request failed with HTTP ${response.status}.`,
    );
  }

  const data = (await response.json()) as {
    choices?: { message?: { content?: unknown } }[];
  };
  const content = data.choices?.[0]?.message?.content;
  return parseBlurb(typeof content === "string" ? content : "");
}

/**
 * Full pipeline: deterministic metrics + the LLM blurb, merged into the
 * directory-facing `CommunitySummary`. Only the trailing window is sent to the
 * LLM so "recentProjects" reflects recent activity.
 */
export async function buildCommunitySummary(
  messages: PresenceMessage[],
  options: BuildSummaryOptions = {},
): Promise<CommunitySummary> {
  const metrics = computeActivityMetrics(messages, options);
  const windowed = messagesInWindow(messages, options);
  const blurb = await summarizeMessages(windowed, options);
  const summary: CommunitySummary = {
    activeMemberCount: metrics.activeMemberCount,
    activityLevel: metrics.activityLevel,
    channelCount: metrics.channelCount,
    goals: blurb.goals,
    messageCount: metrics.messageCount,
    recentProjects: blurb.recentProjects,
    windowDays: metrics.windowDays,
  };
  if (typeof options.totalMemberCount === "number") {
    summary.totalMemberCount = options.totalMemberCount;
  }
  return summary;
}

/**
 * Robustly extracts `{ goals, recentProjects }` from a model completion. Falls
 * back to treating the raw text as the goals blurb when it is not valid JSON,
 * so a well-behaved-but-unfenced model never yields an empty summary.
 */
export function parseBlurb(content: string): CommunityBlurb {
  const trimmed = content.trim();
  const candidate = extractJsonObject(trimmed) ?? trimmed;
  try {
    const parsed = JSON.parse(candidate) as {
      goals?: unknown;
      recentProjects?: unknown;
    };
    const goals =
      typeof parsed.goals === "string" && parsed.goals.trim().length > 0
        ? parsed.goals.trim()
        : trimmed;
    const recentProjects = Array.isArray(parsed.recentProjects)
      ? parsed.recentProjects
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      : [];
    return { goals, recentProjects };
  } catch {
    return { goals: trimmed, recentProjects: [] };
  }
}

/** Returns the first balanced `{...}` block in `text`, or null. */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return null;
}
