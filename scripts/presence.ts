/**
 * BuzzRouter presence CLI — claim an invite, publish the agent profile, and
 * read public community activity from a Buzz relay. The agent key is loaded
 * from `.secrets/buzz-agent.identity.json` or the `BUZZ_AGENT_KEY` override and
 * is never printed.
 *
 * Usage:
 *   node --import tsx scripts/presence.ts claim <host> <code> [--accept-terms]
 *   node --import tsx scripts/presence.ts profile <relayUrl>
 *   node --import tsx scripts/presence.ts read <relayUrl> [channelId] [--live]
 *   node --import tsx scripts/presence.ts summarize <relayUrl>
 */
import { loadAgentIdentity } from "../src/presence/identity";
import { joinCommunity } from "../src/presence/policy";
import { publishProfile } from "../src/presence/profile";
import {
  connectToCommunity,
  readCommunity,
  readMemberCount,
} from "../src/presence/reader";
import { buildCommunitySummary } from "../src/presence/summarize";

function out(line: string): void {
  process.stdout.write(`${line}\n`);
}

function err(line: string): void {
  process.stderr.write(`${line}\n`);
}

async function runClaim(
  host?: string,
  code?: string,
  acceptTerms = false,
): Promise<void> {
  if (!host || !code) {
    throw new Error(
      "Usage: presence claim <host> <code> [--accept-terms]",
    );
  }
  const identity = loadAgentIdentity();
  err(`Claiming invite on ${host} as ${identity.npub}`);
  const result = await joinCommunity({
    acceptTerms,
    code,
    host,
    privateKey: identity.privateKey,
  });

  if (!result.ok && result.reason === "terms_required") {
    err(
      "This community requires a join policy. Joining requires accepting " +
        "Block's Terms of Service AND confirming you are 18 or older. " +
        "Re-run with --accept-terms to accept both and join.",
    );
    process.exitCode = 1;
    return;
  }

  out(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

async function runProfile(relayUrl?: string): Promise<void> {
  if (!relayUrl) {
    throw new Error("Usage: presence profile <relayUrl>");
  }
  const identity = loadAgentIdentity();
  err(`Publishing profile to ${relayUrl} as ${identity.npub}`);
  const connection = await connectToCommunity({ identity, relayUrl });
  try {
    const event = await publishProfile(connection);
    out(JSON.stringify({ id: event.id, kind: event.kind }, null, 2));
  } finally {
    connection.close();
  }
}

async function runRead(
  relayUrl?: string,
  channelId?: string,
  live = false,
): Promise<void> {
  if (!relayUrl) {
    throw new Error(
      "Usage: presence read <relayUrl> [channelId] [--live]",
    );
  }
  const identity = loadAgentIdentity();
  const channelIds = channelId ? [channelId] : undefined;

  if (live) {
    const connection = await connectToCommunity({ identity, relayUrl });
    err(`Live-subscribed to ${relayUrl}; Ctrl-C to stop.`);
    const subscription = connection.subscribeMessages({
      channelIds,
      onMessage: (message) => out(JSON.stringify(message)),
    });
    const stop = () => {
      subscription.close();
      connection.close();
      process.exit(0);
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    return;
  }

  err(`Reading recent activity from ${relayUrl} as ${identity.npub}`);
  const messages = await readCommunity({
    channelIds,
    identity,
    relayUrl,
  });
  err(`Read ${messages.length} message(s).`);
  out(JSON.stringify(messages, null, 2));
}

async function runSummarize(relayUrl?: string): Promise<void> {
  if (!relayUrl) {
    throw new Error("Usage: presence summarize <relayUrl>");
  }
  const identity = loadAgentIdentity();
  err(`Reading recent activity from ${relayUrl} as ${identity.npub}`);
  const messages = await readCommunity({ identity, relayUrl });
  err(`Read ${messages.length} message(s); summarizing.`);

  let totalMemberCount: number | undefined;
  try {
    totalMemberCount = await readMemberCount({ identity, relayUrl });
  } catch (error) {
    err(
      `Member roster unavailable: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const summary = await buildCommunitySummary(messages, {
    totalMemberCount,
  });
  out(JSON.stringify(summary, null, 2));
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const live = rest.includes("--live");
  const acceptTerms = rest.includes("--accept-terms");
  const positional = rest.filter((arg) => !arg.startsWith("--"));

  switch (command) {
    case "claim":
      await runClaim(positional[0], positional[1], acceptTerms);
      return;
    case "profile":
      await runProfile(positional[0]);
      return;
    case "read":
      await runRead(positional[0], positional[1], live);
      return;
    case "summarize":
      await runSummarize(positional[0]);
      return;
    default:
      throw new Error(
        "Usage: presence <claim|profile|read|summarize> ... " +
          "(see file header for details)",
      );
  }
}

main().catch((error: unknown) => {
  err(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
