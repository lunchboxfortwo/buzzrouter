import { resolve } from "node:path";

import { defineConfig } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for Playwright.");
}

const baseURL = "http://127.0.0.1:3210";

// Test-only connector configuration. These enable the real connector
// install/activate code path (shared-channel-unseeded-journey.spec.ts drives it
// against an in-process fake relay). They only configure the test server —
// production supplies its own real package spec and wrapping keys — so nothing
// about production behavior is weakened by setting them here.
const connectorWrappingKeysFile = resolve(
  "e2e/fixtures/connector-wrapping-keys.json",
);
// Trust the fake relay's self-signed 127.0.0.1 cert so the connector's real
// wss:// handshake succeeds without disabling TLS verification anywhere.
const fakeRelayCaCert = resolve("e2e/fixtures/fake-relay-cert.pem");

export default defineConfig({
  expect: { timeout: 5_000 },
  fullyParallel: false,
  reporter: process.env.CI ? "github" : "line",
  testDir: "./e2e",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "npm run start -- --hostname 127.0.0.1 --port 3210",
    env: {
      BUZZROUTER_CONNECTOR_WRAPPING_KEYS_FILE: connectorWrappingKeysFile,
      BUZZROUTER_CONNECTOR_WRAPPING_KEY_VERSION: "1",
      BUZZROUTER_CONNECT_PACKAGE_SPEC: "@buzzrouter/connect@0.0.1",
      DATABASE_SSL: "false",
      DATABASE_URL: databaseUrl,
      NODE_EXTRA_CA_CERTS: fakeRelayCaCert,
      PUBLIC_APP_ORIGIN: baseURL,
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: `${baseURL}/shared-channels`,
  },
  workers: 1,
});
