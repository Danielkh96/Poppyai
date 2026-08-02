import { expect, test } from "@playwright/test";

test("shows an authenticated privacy-safe workspace health summary", async ({ page }) => {
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "运行健康" })).toBeVisible();
  await expect(page.getByLabel("运行指标")).toContainText("保存失败 · 15 分钟");
  await expect(page.getByLabel("运行指标")).toContainText("AI 用量 · 1 小时");
  await expect(
    page.getByText("不包含提示词、回答、文件名、来源 URL 或签名链接")
  ).toBeVisible();

  const response = await page.request.get("/api/operations");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const serialized = JSON.stringify(await response.json());
  expect(serialized).not.toMatch(/prompt|answer|sourceUrl|fileName|signedUrl/i);
});
