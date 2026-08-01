import { expect, test } from "@playwright/test";

test("sign out invalidates the persisted session", async ({ page }) => {
  await page.goto("/boards");
  await expect(page.getByRole("heading", { name: "你的 Boards" })).toBeVisible();
  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);

  await page.goto("/boards");
  await expect(page).toHaveURL(/\/sign-in$/);
});
