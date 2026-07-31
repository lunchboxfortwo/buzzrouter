import { defineConfig } from "@playwright/test";

const databaseUrl = process.env.TEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for Playwright.");
}

const baseURL = "http://127.0.0.1:3210";

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
      DATABASE_SSL: "false",
      DATABASE_URL: databaseUrl,
      PUBLIC_APP_ORIGIN: baseURL,
    },
    reuseExistingServer: false,
    timeout: 30_000,
    url: `${baseURL}/shared-channels`,
  },
  workers: 1,
});
