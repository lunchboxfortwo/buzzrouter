#!/usr/bin/env node

import { runInstaller } from "../src/installer.js";

try {
  await runInstaller(process.argv.slice(2));
} catch (error) {
  process.stderr.write(
    `BuzzRouter connector setup failed: ${safeMessage(error)}\n`,
  );
  process.exitCode = 1;
}

function safeMessage(error) {
  return error instanceof Error ? error.message : "unknown error";
}
