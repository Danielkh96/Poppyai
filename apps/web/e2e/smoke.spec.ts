import { expect, test } from "@playwright/test";

test("M1 overview exposes the authenticated workspace", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Siftloom/);
  await expect(
    page.getByRole("heading", { name: "把零散来源，编织成可追溯答案。" })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /创建第一张 Board/ })).toHaveAttribute(
    "href",
    "/sign-in"
  );
});

test("health route is private-content free", async ({ request }) => {
  const response = await request.get("/api/health");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toEqual({
    status: "ok",
    service: "siftloom-web",
    milestone: "M4",
    time: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)
  });
});

test("canvas route renders the fixed workload shell", async ({ page }) => {
  await page.goto("/prototype/canvas");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await expect(page.getByText("200 nodes · 300 edges")).toBeVisible();
  await expect(page.getByRole("button", { name: "运行 5 秒基准" })).toBeEnabled();
});
