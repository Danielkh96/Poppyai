import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

for (const [label, path] of [
  ["boards", "/boards"],
  ["operations", "/operations"],
  ["trust", "/trust"]
] as const) {
  test(`${label} has no detectable WCAG A/AA violations`, async ({ page }) => {
    await page.goto(path);
    const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(
      result.violations,
      result.violations.map((violation) => `${violation.id}: ${violation.help}`).join("\n")
    ).toEqual([]);
  });
}

test("supports skip navigation and narrow read-only operational access", async ({
  browserName,
  page
}) => {
  await page.goto("/boards");
  await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
  const skipLink = page.getByRole("link", { name: "跳到主要内容" });
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);

  await page.setViewportSize({ width: 360, height: 640 });
  await page.goto("/operations");
  await expect(page.getByRole("heading", { name: "运行健康" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth
  );
  expect(overflow).toBe(false);
});
