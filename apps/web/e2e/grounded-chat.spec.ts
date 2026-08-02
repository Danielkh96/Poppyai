import { expect, test } from "@playwright/test";

test("streams a grounded answer, persists history, and opens the frozen citation", async ({
  browserName,
  page
}) => {
  const boardName = `M4 chat · ${browserName} · ${crypto.randomUUID().slice(0, 8)}`;
  const createResponse = await page.request.post("/api/boards", {
    data: { mutationId: crypto.randomUUID(), name: boardName }
  });
  expect(createResponse.status()).toBe(201);
  const { board } = (await createResponse.json()) as { board: { id: string } };

  await page.goto(`/boards/${board.id}`);
  await page.getByRole("button", { name: "便笺", exact: true }).click();
  await page.getByRole("button", { name: "AI 对话", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /便笺 1/ })
    .click();
  await page.getByLabel("节点属性").getByLabel("标题").fill("M4 研究笔记");
  await page
    .getByLabel("节点属性")
    .getByLabel("正文")
    .fill("Alpha 是冻结来源中的核心事实。");
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });
  await page.getByRole("button", { name: "连接到 AI 对话 2" }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /AI 对话 2/ })
    .click();
  const inspector = page.getByTestId("chat-inspector");
  await expect(inspector).toContainText("S1 · M4 研究笔记");
  await inspector.getByPlaceholder("根据已连接来源提问…").fill("核心事实是什么？");
  await inspector.getByTitle("发送").click();
  await expect(inspector).toContainText("核心事实是什么？");
  await expect(inspector).toContainText("已根据 1 个授权来源生成。", { timeout: 10_000 });
  await inspector.getByRole("button", { name: /\[S1\]/ }).click();
  await expect(page.getByRole("dialog")).toContainText("M4 研究笔记");
  await expect(page.getByRole("dialog")).toContainText("Alpha 是冻结来源中的核心事实。");
  await page.getByRole("button", { name: "关闭来源快照" }).click();

  await page.reload();
  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /AI 对话 2/ })
    .click();
  await expect(page.getByTestId("chat-inspector")).toContainText("核心事实是什么？");
  await expect(page.getByTestId("chat-inspector")).toContainText(
    "已根据 1 个授权来源生成。"
  );
});
