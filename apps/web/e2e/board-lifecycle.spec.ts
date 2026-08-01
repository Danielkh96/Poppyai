import { expect, test, type BrowserContext } from "@playwright/test";

import { supportAuthState } from "./auth-state";

async function closeContext(context: BrowserContext) {
  await context.close();
}

test("authenticated users can complete the board lifecycle with tenant isolation", async ({
  browser,
  browserName,
  page
}) => {
  await page.goto("/boards");
  await expect(page.getByRole("heading", { name: "你的 Boards" })).toBeVisible();

  const testRun = crypto.randomUUID().slice(0, 8);
  const boardName = `Launch sources · ${browserName} · ${testRun}`;
  const renamedBoardName = `Renamed sources · ${browserName} · ${testRun}`;
  await page.getByLabel("新 Board 名称").fill(boardName);
  await page.getByRole("button", { name: "创建" }).click();
  const launchCard = page.getByRole("article").filter({ hasText: boardName });
  await expect(launchCard).toBeVisible();

  const mutationId = crypto.randomUUID();
  const duplicateIds = await page.evaluate(async (id) => {
    const request = () =>
      fetch("/api/boards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mutationId: id, name: `Idempotent board · ${id}` })
      }).then(async (response) => {
        if (!response.ok) throw new Error(`create failed: ${response.status}`);
        return (await response.json()) as { board: { id: string } };
      });
    const [first, second] = await Promise.all([request(), request()]);
    return [first.board.id, second.board.id];
  }, mutationId);
  expect(duplicateIds[0]).toBe(duplicateIds[1]);

  page.once("dialog", (dialog) => dialog.accept(renamedBoardName));
  await launchCard.getByRole("button", { name: `重命名 ${boardName}` }).click();
  await expect(page.getByRole("heading", { name: renamedBoardName })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: renamedBoardName })).toBeVisible();

  const renamedCard = page.getByRole("article").filter({ hasText: renamedBoardName });
  page.once("dialog", (dialog) => dialog.accept());
  await renamedCard.getByRole("button", { name: `归档 ${renamedBoardName}` }).click();
  await expect(page.getByRole("heading", { name: renamedBoardName })).toHaveCount(0);
  await page.getByRole("tab", { name: /已归档/ }).click();
  await expect(page.getByRole("heading", { name: renamedBoardName })).toBeVisible();
  await page
    .getByRole("article")
    .filter({ hasText: renamedBoardName })
    .getByRole("button", { name: "恢复" })
    .click();
  await expect(page.getByRole("heading", { name: renamedBoardName })).toHaveCount(0);
  await page.getByRole("tab", { name: /使用中/ }).click();
  await expect(page.getByRole("heading", { name: renamedBoardName })).toBeVisible();

  const privateBoardId = duplicateIds[0]!;
  const otherContext = await browser.newContext({ storageState: supportAuthState });
  const otherPage = await otherContext.newPage();
  try {
    await otherPage.goto("/boards");
    await expect(otherPage.getByRole("heading", { name: "你的 Boards" })).toBeVisible();
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
});
