import { expect, test } from "@playwright/test";

test("authors, saves, restores, and conflict-checks a persistent canvas", async ({
  browserName,
  page
}) => {
  await page.goto("/boards");
  const boardName = `M2 canvas · ${browserName} · ${crypto.randomUUID().slice(0, 8)}`;
  const createResponse = await page.request.post("/api/boards", {
    data: { mutationId: crypto.randomUUID(), name: boardName }
  });
  expect(createResponse.status()).toBe(201);
  const { board } = (await createResponse.json()) as { board: { id: string } };

  await page.goto(`/boards/${board.id}`);
  await expect(page.getByRole("heading", { name: boardName })).toBeVisible();
  await expect(page.getByLabel("可编辑的 Siftloom 无限画布")).toBeVisible();

  await page.getByRole("button", { name: "便笺", exact: true }).click();
  await page.getByRole("button", { name: "AI 对话", exact: true }).click();
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await expect(page.getByLabel("语义化 Board 大纲").getByRole("listitem")).toHaveCount(3);

  const noteOutline = page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /便笺 1/ });
  await noteOutline.click();
  await page.getByLabel("节点属性").getByLabel("标题").fill("访谈洞察");
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /访谈洞察/ })
    .click();
  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /文本 3/ })
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "组合", exact: true }).click();
  await expect(page.getByLabel("语义化 Board 大纲").getByRole("list")).toContainText(
    "分组 4"
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByLabel("语义化 Board 大纲").getByRole("list")).not.toContainText(
    "分组 4"
  );
  await page.getByTitle("重做 (⇧⌘Z)").click();
  await expect(page.getByLabel("语义化 Board 大纲").getByRole("list")).toContainText(
    "分组 4"
  );

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /访谈洞察/ })
    .click();
  await page.getByRole("button", { name: "连接到 AI 对话 2" }).click();
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel("语义化 Board 大纲")).toContainText("访谈洞察");
  await expect(page.locator(".react-flow__edge")).toHaveCount(1);

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /访谈洞察/ })
    .click();
  await page.getByRole("button", { name: "移至最近删除" }).click();
  await expect(page.getByLabel("语义化 Board 大纲").getByRole("list")).not.toContainText(
    "访谈洞察"
  );
  await page.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByLabel("语义化 Board 大纲")).toContainText("访谈洞察");
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

  const remoteWriteStatus = await page.evaluate(async (boardId) => {
    const snapshotResponse = await fetch(`/api/boards/${boardId}/canvas`);
    const { snapshot } = (await snapshotResponse.json()) as {
      snapshot: {
        boardRevision: number;
        graph: {
          nodes: Array<
            Record<string, unknown> & {
              id: string;
              revision: number;
              payload: Record<string, unknown> & { title?: string };
            }
          >;
        };
      };
    };
    const target = snapshot.graph.nodes.find((node) => node.payload.title === "访谈洞察");
    if (!target) throw new Error("Canvas conflict target is missing");
    const response = await fetch(`/api/boards/${boardId}/canvas`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mutationId: crypto.randomUUID(),
        baseBoardRevision: snapshot.boardRevision,
        operations: [
          {
            type: "node.upsert",
            expectedRevision: target.revision,
            node: {
              ...target,
              payload: { ...target.payload, title: "Remote conflicting version" }
            }
          }
        ]
      })
    });
    return response.status;
  }, board.id);
  expect(remoteWriteStatus).toBe(200);

  await page.getByLabel("节点属性").getByLabel("标题").fill("本地保留版本");
  await expect(page.getByRole("status")).toContainText("发现版本冲突", {
    timeout: 10_000
  });
  await page.getByRole("button", { name: "保留本地并重试" }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });
  await page.reload();
  await expect(page.getByLabel("语义化 Board 大纲")).toContainText("本地保留版本");
});
