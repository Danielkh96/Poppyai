import { expect, test as setup, type Browser } from "@playwright/test";

import { primaryAuthState, supportAuthState } from "./auth-state";

async function createLocalAccount(browser: Browser, label: string, statePath: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const emailLabel = label.toLowerCase().replaceAll(" ", "-");
  const identity = `${emailLabel}-${crypto.randomUUID()}@example.test`;

  await page.goto("/sign-in");
  await page.getByLabel("昵称").fill(label);
  await page.getByLabel("邮箱").fill(identity);
  await page.getByLabel("密码").fill("local-test-password-2026");
  await page.getByRole("button", { name: "创建并进入工作区" }).click();
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByRole("heading", { name: "你的 Boards" })).toBeVisible();
  await context.storageState({ path: statePath });
  await context.close();
}

setup("create two rate-limit-safe authenticated tenant fixtures", async ({ browser }) => {
  await createLocalAccount(browser, "M1 Primary Owner", primaryAuthState);
  await createLocalAccount(browser, "M1 Support Owner", supportAuthState);
});
