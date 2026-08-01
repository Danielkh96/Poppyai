import { defineConfig, devices } from "@playwright/test";

import { primaryAuthState } from "./e2e/auth-state";

const port = process.env.PLAYWRIGHT_PORT ?? "3207";
const baseURL = `http://127.0.0.1:${port}`;
const useProductionServer = process.env.PLAYWRIGHT_PRODUCTION === "1";
const supportFiles = [
  /auth\.setup\.ts/,
  /auth\.teardown\.ts/,
  /canvas-benchmark\.spec\.ts/
];

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "auth-setup",
      testMatch: /auth\.setup\.ts/,
      teardown: "auth-teardown",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "auth-teardown",
      testMatch: /auth\.teardown\.ts/,
      use: { ...devices["Desktop Chrome"], storageState: primaryAuthState }
    },
    {
      name: "chromium",
      testIgnore: supportFiles,
      dependencies: ["auth-setup"],
      use: { ...devices["Desktop Chrome"], storageState: primaryAuthState }
    },
    {
      name: "firefox",
      testIgnore: supportFiles,
      dependencies: ["auth-setup"],
      use: { ...devices["Desktop Firefox"], storageState: primaryAuthState }
    },
    {
      name: "webkit",
      testIgnore: supportFiles,
      dependencies: ["auth-setup"],
      use: { ...devices["Desktop Safari"], storageState: primaryAuthState }
    },
    {
      name: "canvas-benchmark",
      testMatch: /canvas-benchmark\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] }
    }
  ],
  webServer: {
    command: useProductionServer
      ? `BETTER_AUTH_URL=${baseURL} corepack pnpm build && BETTER_AUTH_URL=${baseURL} corepack pnpm exec next start --hostname 127.0.0.1 --port ${port}`
      : `BETTER_AUTH_URL=${baseURL} corepack pnpm exec next dev --hostname 127.0.0.1 --port ${port}`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000
  }
});
