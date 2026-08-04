import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { isBuzzInviteCode } from "../src/directory/invite-code-format";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT = join(ROOT, "scripts/refresh-home-invite.sh");
const temporaryDirectories: string[] = [];

function runCheck(code: string) {
  const fakeBin = mkdtempSync(join(tmpdir(), "refresh-home-invite-test-"));
  temporaryDirectories.push(fakeBin);

  const docker = join(fakeBin, "docker");
  writeFileSync(
    docker,
    `#!/usr/bin/env bash
set -euo pipefail
if [[ " $* " == *" psql "* ]]; then
  printf '%s\\n' "$FAKE_STORED_CODE"
else
  CODE="$FAKE_STORED_CODE" exec "$FAKE_NODE" -
fi
`,
  );
  chmodSync(docker, 0o755);

  return spawnSync("bash", [SCRIPT, "--check"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FAKE_NODE: process.execPath,
      FAKE_STORED_CODE: code,
      PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
    },
  });
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("refresh-home-invite.sh --check", () => {
  it.each([
    "v2.umQGOlbNHvzs5fDVgxWCcU1N6ZmKr_3QAqPiuM4AgV4",
    "v37.someFutureOpaqueToken_123",
  ])("defers opaque %s expiry to the live joinability probe", (code) => {
    expect(isBuzzInviteCode(code)).toBe(true);

    const result = runCheck(code);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toBe(
      "invite expiry/validity is governed by the live joinability probe, not embedded in the code",
    );
  });

  it("keeps decoding expiry from legacy eyJ JSON codes", () => {
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({ e: now + 2 * 86400 })).toString(
      "base64url",
    );
    expect(isBuzzInviteCode(`${payload}.signature`)).toBe(true);

    const result = runCheck(`${payload}.signature`);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toMatch(
      /^invite valid for (?:1\.9|2\.0) more days$/,
    );
  });

  it("keeps the containerized, sudo-free execution model", () => {
    const source = readFileSync(SCRIPT, "utf8");

    expect(source).toContain(
      'docker exec -i -e CODE="$1" "$APP_CONTAINER" node -',
    );
    expect(source).not.toMatch(/^\s*sudo\b/m);
    expect(execFileSync("bash", ["-n", SCRIPT], { encoding: "utf8" })).toBe("");
  });
});
