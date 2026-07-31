import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

const DEFAULT_ROUTER = "https://buzzrouter.com";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function runInstaller(
  argv,
  dependencies = {},
) {
  const options = parseArguments(argv);
  const request = dependencies.request ?? postJson;
  const runAdmin = dependencies.runAdmin ?? runBuzzAdmin;
  const output = dependencies.output ?? process.stdout;

  const descriptor = await request(
    options.router,
    "/api/community-connections/install",
    { token: options.token },
  );
  assertDescriptor(descriptor);
  output.write(`Admitting BuzzRouter bridge ${descriptor.bridgePubkey}\n`);
  await runAdmin(descriptor);
  const activation = await request(
    options.router,
    "/api/community-connections/activate",
    { token: options.token },
  );
  if (
    !activation ||
    activation.state !== "active" ||
    activation.bridgePubkey !== descriptor.bridgePubkey
  ) {
    throw new Error("BuzzRouter did not activate the connector.");
  }
  output.write(`Connector active for ${descriptor.relayUrl}\n`);
}

export function parseArguments(argv) {
  let token;
  let router = DEFAULT_ROUTER;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--router") {
      router = argv[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new Error(`Unknown option: ${argument}`);
    }
    if (token) {
      throw new Error("Only one install token is accepted.");
    }
    token = argument;
  }
  if (!token || !TOKEN_PATTERN.test(token)) {
    throw new Error("A valid one-time install token is required.");
  }

  let parsed;
  try {
    parsed = new URL(router);
  } catch {
    throw new Error("Router URL is invalid.");
  }
  const loopback =
    parsed.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname);
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    (parsed.protocol !== "https:" && !loopback)
  ) {
    throw new Error("Router URL must be an HTTPS origin.");
  }
  return { router: parsed.origin, token };
}

async function postJson(origin, path, body) {
  const response = await fetch(new URL(path, origin), {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("BuzzRouter returned an invalid response.");
  }
  if (!response.ok) {
    throw new Error(
      typeof result.error === "string"
        ? result.error
        : "BuzzRouter rejected the install request.",
    );
  }
  return result;
}

/**
 * buzz-admin accepts only 'member' or 'admin'. The bridge needs to read and
 * publish in its mapped channels, nothing more.
 */
export const BRIDGE_ROLE = "member";

export function buildAdminArguments(command, descriptor) {
  return [
    ...command.slice(1),
    "add-member",
    "--pubkey",
    descriptor.bridgePubkey,
    "--role",
    BRIDGE_ROLE,
  ];
}

async function runBuzzAdmin(descriptor) {
  const command = await resolveAdminCommand();
  await spawnCommand(
    command[0],
    buildAdminArguments(command, descriptor),
    {
      ...process.env,
      BUZZ_RELAY_URL: descriptor.relayUrl,
    },
  );
}

async function resolveAdminCommand() {
  const configured = process.env.BUZZROUTER_ADMIN_COMMAND;
  if (configured) {
    let command;
    try {
      command = JSON.parse(configured);
    } catch {
      throw new Error(
        "BUZZROUTER_ADMIN_COMMAND must be a JSON command array.",
      );
    }
    if (
      !Array.isArray(command) ||
      command.length === 0 ||
      !command.every(
        (part) => typeof part === "string" && part.length > 0,
      )
    ) {
      throw new Error(
        "BUZZROUTER_ADMIN_COMMAND must be a JSON command array.",
      );
    }
    return command;
  }

  try {
    await access("./run.sh", constants.X_OK);
    return ["./run.sh"];
  } catch {
    return ["buzz-admin"];
  }
}

function spawnCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: "inherit",
    });
    child.once("error", (error) => {
      reject(
        error.code === "ENOENT"
          ? new Error(
              "buzz-admin was not found; run this command on the Buzz relay host.",
            )
          : error,
      );
    });
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          signal
            ? `buzz-admin stopped by ${signal}.`
            : `buzz-admin exited with status ${code ?? "unknown"}.`,
        ),
      );
    });
  });
}

function assertDescriptor(value) {
  if (
    !value ||
    typeof value.bridgePubkey !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.bridgePubkey) ||
    typeof value.relayUrl !== "string" ||
    !/^wss?:\/\//.test(value.relayUrl)
  ) {
    throw new Error("BuzzRouter returned an invalid install descriptor.");
  }
}
