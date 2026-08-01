import { extractInvites, type HarvestedInvite } from "./extract-invites";

/**
 * A RECALL-ONLY second pass over chat messages that widens invite extraction
 * beyond the two structured formats `extractInvites` recognizes.
 *
 * People post invites messily — bare codes, "join here: <wrapped/shortened
 * url>", a typo'd scheme, a code split across prose — and those slip past the
 * deterministic regex and are lost. This pass asks an LLM to surface candidate
 * invites in canonical form, but it can NEVER cause a bad invite to be trusted:
 *
 *   - Every string the model returns is fed back through `extractInvites`, so it
 *     is re-validated by the same deterministic regex/host logic. A hallucinated
 *     or malformed candidate simply produces nothing.
 *   - Downstream, harvested invites still flow through the same claim-probe /
 *     directory-verification pipeline before anything is trusted or joined.
 *
 * So the LLM can only ADD recall — it cannot bypass any check. To keep it cheap
 * and safe it is gated twice: a deterministic pre-filter drops messages that are
 * not invite-ish or that the regex already caught, and a missing API key (or any
 * transport/parse error) degrades gracefully to `[]` rather than throwing.
 */

const DEFAULT_OPENROUTER_ORIGIN = "https://openrouter.ai";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
/** Cap the messages sent to the model so a busy batch can't blow the context. */
const DEFAULT_MAX_MESSAGES = 40;

/**
 * Cheap pre-filter: only messages that look like they might carry an invite.
 * Deliberately broad — an invite can be worded ("hop on our relay, code ..."),
 * so we let anything invite-ish through to the model and lean on the downstream
 * re-validation + probe-verification to reject noise. Widening recall here can
 * only cost an extra (cheap) model call; it cannot cause a bad invite to be
 * trusted.
 */
const INVITE_ISH_RE =
  /invite|\bjoin\b|wss:\/\/|buzz:\/\/|\/invite\/|communities\.|\bcode\b|\brelay\b/i;

const SYSTEM_PROMPT = [
  "You extract Buzz community invite links from chat messages and channel",
  "descriptions. Invites are often posted messily: a bare code next to a relay",
  "host, a worded 'join us at <host>, code <code>', a typo'd or missing scheme,",
  "or a code split across a sentence. Reconstruct each one you are confident",
  "about into canonical form `buzz://join?relay=wss://HOST&code=CODE` (or the",
  "web form `https://HOST/invite/CODE`).",
  "You must be able to identify BOTH a relay host and a code from the text —",
  "never guess or invent a host or code that is not actually present. When only",
  "a bare code appears with no host anywhere near it, skip it.",
  'Return ONLY JSON: {"invites": string[]}. If none, empty array.',
].join("\n");

export interface LlmExtractOptions {
  fetchImpl?: typeof fetch;
  apiKey?: string;
  model?: string;
  /**
   * Origin the OpenRouter-compatible endpoint is built from; the request is
   * POSTed to `${baseUrl}/api/v1/chat/completions`. Defaults to
   * `OPENROUTER_BASE_URL` then `https://openrouter.ai`.
   */
  baseUrl?: string;
  /** Max invite-ish messages sent to the model. Defaults to 40. */
  maxMessages?: number;
}

/**
 * LLM recall pass. Pre-filters to invite-ish messages the regex missed, asks the
 * model for canonical invite links, then re-validates every returned string
 * through `extractInvites`. Returns the `(relayHost, code)`-deduplicated survivors.
 *
 * Never throws: a missing API key or any transport/parse error yields `[]`. No
 * LLM call is made when nothing survives the pre-filter (cost control).
 */
export async function llmExtractInvites(
  messages: { content: string }[],
  options: LlmExtractOptions = {},
): Promise<HarvestedInvite[]> {
  const maxMessages = options.maxMessages ?? DEFAULT_MAX_MESSAGES;

  // Pre-filter (deterministic, no LLM): keep only invite-ish messages that the
  // regex did NOT already catch on their own — the regex owns the rest.
  const candidates: string[] = [];
  for (const message of messages) {
    const content = message?.content;
    if (typeof content !== "string" || content.length === 0) continue;
    if (!INVITE_ISH_RE.test(content)) continue;
    if (extractInvites(content).length > 0) continue;
    candidates.push(content);
    if (candidates.length >= maxMessages) break;
  }

  // Nothing worth asking the model about — skip the call entirely.
  if (candidates.length === 0) return [];

  const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) return [];

  const model = options.model ?? process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin =
    options.baseUrl ??
    process.env.OPENROUTER_BASE_URL ??
    DEFAULT_OPENROUTER_ORIGIN;
  const url = `${origin}/api/v1/chat/completions`;

  const requestBody = JSON.stringify({
    messages: [
      { content: SYSTEM_PROMPT, role: "system" },
      { content: JSON.stringify(candidates), role: "user" },
    ],
    model,
    response_format: { type: "json_object" },
  });

  let raw: string;
  try {
    const response = await fetchImpl(url, {
      body: requestBody,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      choices?: { message?: { content?: unknown } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    raw = typeof content === "string" ? content : "";
  } catch {
    // Transport / JSON-decode failure — degrade to no extra recall.
    return [];
  }

  const strings = parseInviteStrings(raw);

  // Re-validate EVERY candidate through the deterministic extractor and dedupe
  // by (relayHost, code). Anything malformed or hallucinated drops out here.
  const seen = new Set<string>();
  const invites: HarvestedInvite[] = [];
  for (const candidate of strings) {
    for (const invite of extractInvites(candidate)) {
      const key = `${invite.relayHost} ${invite.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      invites.push(invite);
    }
  }
  return invites;
}

/**
 * Robustly pulls the `invites` string array out of a model completion. Tolerates
 * prose/code-fence wrapping around the JSON object; any failure yields `[]`.
 */
function parseInviteStrings(content: string): string[] {
  const trimmed = content.trim();
  const candidate = extractJsonObject(trimmed) ?? trimmed;
  try {
    const parsed = JSON.parse(candidate) as { invites?: unknown };
    if (!Array.isArray(parsed.invites)) return [];
    return parsed.invites.filter(
      (item): item is string => typeof item === "string",
    );
  } catch {
    return [];
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
