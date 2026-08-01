import { expect, test, type BrowserContext, type Page } from "@playwright/test";

async function createLocalAccount(page: Page, label: string) {
  const emailLabel = label.toLowerCase().replaceAll(" ", "-");
  const identity = `${emailLabel}-${crypto.randomUUID()}@example.test`;
  await page.goto("/sign-in");
  await page.getByLabel("昵称").fill(label);
  await page.getByLabel("邮箱").fill(identity);
  await page.getByLabel("密码").fill("local-test-password-2026");
  await page.getByRole("button", { name: "创建并进入工作区" }).click();
  await expect(page).toHaveURL(/\/boards$/);
  await expect(page.getByRole("heading", { name: "你的 Boards" })).toBeVisible();
}

async function closeContext(context: BrowserContext) {
  await context.close();
}

test("authenticated users can complete the board lifecycle with tenant isolation", async ({
  browser,
  page
}) => {
  await createLocalAccount(page, "M1 Owner A");

  await page.getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("heading", { name: "未命名 Board" })).toBeVisible();

  await page.getByLabel("新 Board 名称").fill("Launch sources");
  await page.getByRole("button", { name: "创建" }).click();
  const launchCard = page.getByRole("article").filter({ hasText: "Launch sources" });
  await expect(launchCard).toBeVisible();

  const mutationId = crypto.randomUUID();
  const duplicateIds = await page.evaluate(async (id) => {
    const request = () =>
      fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutationId: id, name: "Idempotent board" })
      }).then(async (response) => {
        if (!response.ok) throw new Error(`create failed: ${response.status}`);
        return (await response.json()) as { board: { id: string } };
      });
    const [first, second] = await Promise.all([request(), request()]);
    return [first.board.id, second.board.id];
  }, mutationId);
  expect(duplicateIds[0]).toBe(duplicateIds[1]);

  page.once("dialog", (dialog) => dialog.accept("Renamed sources"));
  await launchCard.getByRole("button", { name: "重命名 Launch sources" }).click();
  await expect(page.getByRole("heading", { name: "Renamed sources" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Renamed sources" })).toBeVisible();

  const renamedCard = page.getByRole("article").filter({ hasText: "Renamed sources" });
  page.once("dialog", (dialog) => dialog.accept());
  await renamedCard.getByRole("button", { name: "归档 Renamed sources" }).click();
  await expect(page.getByRole("heading", { name: "Renamed sources" })).toHaveCount(0);
  await page.getByRole("tab", { name: /已归档/ }).click();
  await expect(page.getByRole("heading", { name: "Renamed sources" })).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: "Renamed sources" })
    .getByRole("button", { name: "恢复" })
    .click();
  await expect(page.getByRole("heading", { name: "Renamed sources" })).toHaveCount(0);
  await page.getByRole("tab", { name: /使用中/ }).click();
  await expect(page.getByRole("heading", { name: "Renamed sources" })).toBeVisible();

  const privateBoardId = duplicateIds[0]!;
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  try {
    await createLocalAccount(otherPage, "M1 Owner B");
    const foreignRead = await otherPage.request.get(`/api/boards/${privateBoardId}`);
    expect(foreignRead.status()).toBe(404);
    await expect(foreignRead.json()).resolves.toEqual({
      error: { code: "BOARD_NOT_FOUND", message: "找不到该 Board。" }
    });
    const foreignMutation = await otherPage.request.patch(`/api/boards/${privateBoardId}`, {
      data: { action: "archive" }
    });
    expect(foreignMutation.status()).toBe(404);
  } finally {
    await closeContext(otherContext);
  }

  await page.getByRole("button", { name: "退出" }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await page.goto("/boards");
  await expect(page).toHaveURL(/\/sign-in$/);
});
