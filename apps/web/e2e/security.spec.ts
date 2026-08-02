import { expect, test } from "@playwright/test";

test("serves restrictive security headers and rejects forged browser origins", async ({
  request
}) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");
  expect(health.headers()["x-frame-options"]).toBe("DENY");
  expect(health.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(health.headers()["permissions-policy"]).toContain("camera=()");
  expect(health.headers()["content-security-policy"]).toContain("object-src 'none'");
  expect(health.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");

  const forged = await request.post("/api/boards", {
    headers: { Origin: "https://attacker.example" },
    data: { mutationId: crypto.randomUUID(), name: "Must not be created" }
  });
  expect(forged.status()).toBe(403);
  await expect(forged.json()).resolves.toEqual({
    error: { code: "UNTRUSTED_ORIGIN", message: "无法验证请求来源。" }
  });
});

test("renders hostile board names as inert text", async ({ page }) => {
  const hostileName = `<img src=x onerror="window.__siftloomXss=true">-${crypto.randomUUID()}`;
  const response = await page.request.post("/api/boards", {
    data: { mutationId: crypto.randomUUID(), name: hostileName }
  });
  expect(response.status()).toBe(201);
  await page.goto("/boards");
  const card = page.getByRole("article").filter({ hasText: hostileName });
  await expect(card).toBeVisible();
  await expect(card.locator("img")).toHaveCount(0);
  await expect(page.evaluate(() => Boolean(window.__siftloomXss))).resolves.toBe(false);
});

declare global {
  interface Window {
    __siftloomXss?: boolean;
  }
}
