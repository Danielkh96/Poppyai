import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3207";
const baseURL = `http://127.0.0.1:${port}`;
const useProductionServer = process.env.PLAYWRIGHT_PRODUCTION === "1";

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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } }
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
