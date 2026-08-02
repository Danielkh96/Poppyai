import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { expect, test, type BrowserContext } from "@playwright/test";

import { supportAuthState } from "./auth-state";

let worker: ChildProcess | undefined;

test.beforeAll(async () => {
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  worker = spawn("corepack", ["pnpm", "--filter", "@siftloom/worker", "dev"], {
    cwd: repositoryRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Worker did not start")), 15_000);
    const inspect = (chunk: Buffer) => {
      if (!chunk.toString().includes('"event":"worker.started"')) return;
      clearTimeout(timeout);
      resolve();
    };
    worker?.stdout?.on("data", inspect);
    worker?.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Worker exited before startup (${String(code)})`));
    });
  });
});

test.afterAll(async () => {
  if (!worker || worker.exitCode !== null) return;
  worker.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 5_000);
    worker?.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
});

async function closeContext(context: BrowserContext) {
  await context.close();
}

test("completes the canonical private-alpha journey", async ({
  browser,
  browserName,
  page
}) => {
  test.setTimeout(60_000);
  const boardName = `M5 release · ${browserName} · ${crypto.randomUUID().slice(0, 8)}`;
  const createResponse = await page.request.post("/api/boards", {
    data: { mutationId: crypto.randomUUID(), name: boardName }
  });
  expect(createResponse.status()).toBe(201);
  const { board } = (await createResponse.json()) as { board: { id: string } };

  await page.goto(`/boards/${board.id}`);
  await page.getByRole("button", { name: "文本", exact: true }).click();
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await page.getByRole("button", { name: "AI 对话", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /文本 1/ })
    .click();
  await page.getByLabel("节点属性").getByLabel("标题").fill("Release text source");
  await page
    .getByLabel("节点属性")
    .getByLabel("正文")
    .fill("Alpha release fact belongs to the authorized text source.");
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });
  await page.getByRole("button", { name: "连接到 AI 对话 3" }).click();

  await page.getByLabel("语义化 Board 大纲").getByRole("button", { name: /PDF 2/ }).click();
  const fixture = path.resolve(
    process.cwd(),
    "../../packages/ingestion/test/fixtures/m3-sample.txt"
  );
  await page.getByLabel("PDF 或 TXT 文件").setInputFiles(fixture);
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });
  await page.getByRole("button", { name: "上传并提取", exact: true }).click();
  await expect(page.getByLabel("节点属性")).toContainText("内容已就绪", {
    timeout: 15_000
  });
  await page.getByRole("button", { name: "连接到 AI 对话 3" }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

  const snapshotResponse = await page.request.get(`/api/boards/${board.id}/canvas`);
  const { snapshot } = (await snapshotResponse.json()) as {
    snapshot: {
      boardRevision: number;
      graph: {
        nodes: Array<{
          id: string;
          kind: string;
          parentId: string | null;
          position: { x: number; y: number };
          size: { width: number; height: number };
          revision: number;
          payload: Record<string, unknown>;
        }>;
      };
    };
  };
  const textNode = snapshot.graph.nodes.find((node) => node.kind === "text");
  if (!textNode) throw new Error("Release text node is missing");
  const geometryResponse = await page.request.put(`/api/boards/${board.id}/canvas`, {
    data: {
      mutationId: crypto.randomUUID(),
      baseBoardRevision: snapshot.boardRevision,
      operations: [
        {
          type: "node.upsert",
          expectedRevision: textNode.revision,
          node: {
            ...textNode,
            position: { x: 512, y: 288 },
            size: { width: 360, height: 220 }
          }
        }
      ]
    }
  });
  expect(geometryResponse.status()).toBe(200);

  await page.reload();
  await expect(page.getByLabel("语义化 Board 大纲")).toContainText("Release text source");
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
  const persistedResponse = await page.request.get(`/api/boards/${board.id}/canvas`);
  const persisted = (await persistedResponse.json()) as { snapshot: typeof snapshot };
  expect(
    persisted.snapshot.graph.nodes.find((node) => node.id === textNode.id)
  ).toMatchObject({
    position: { x: 512, y: 288 },
    size: { width: 360, height: 220 }
  });

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /AI 对话 3/ })
    .click();
  const inspector = page.getByTestId("chat-inspector");
  await expect(inspector).toContainText("S1 · Release text source");
  await expect(inspector).toContainText("S2 · PDF 2");
  const prompt = inspector.getByPlaceholder("根据已连接来源提问…");
  await prompt.fill("总结两项来源。");
  await inspector.getByTitle("发送").click();
  await expect(prompt).toHaveValue("");
  await page.reload();
  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /AI 对话 3/ })
    .click();
  await expect(inspector).toContainText("已根据 2 个授权来源生成。", {
    timeout: 15_000
  });
  await inspector.getByRole("button", { name: /\[S1\]/ }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Alpha release fact belongs to the authorized text source."
  );
  await page.getByRole("button", { name: "关闭来源快照" }).click();

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /Release text source/ })
    .click();
  await page
    .getByLabel("节点属性")
    .getByLabel("正文")
    .fill("Beta release fact is the current edited source version.");
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });
  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /AI 对话 3/ })
    .click();
  await inspector.getByRole("button", { name: /\[S1\]/ }).click();
  await expect(page.getByRole("dialog")).toContainText("画布来源已变化");
  await expect(page.getByRole("dialog")).toContainText(
    "Alpha release fact belongs to the authorized text source."
  );
  await page.getByRole("button", { name: "关闭来源快照" }).click();

  await page
    .getByLabel("语义化 Board 大纲")
    .getByRole("button", { name: /Release text source/ })
    .click();
  await page.getByRole("button", { name: "移至最近删除" }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });
  await page.reload();
  const deletedText = page.locator(".m2-deleted > div").filter({
    hasText: "Release text source"
  });
  await expect(deletedText).toBeVisible();
  await deletedText.getByRole("button", { name: "恢复" }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });
  await expect(page.getByLabel("语义化 Board 大纲")).toContainText("Release text source");

  const otherContext = await browser.newContext({ storageState: supportAuthState });
  const otherPage = await otherContext.newPage();
  try {
    const foreignRead = await otherPage.request.get(`/api/boards/${board.id}/canvas`);
    expect(foreignRead.status()).toBe(404);
  } finally {
    await closeContext(otherContext);
  }

  const archived = await page.request.patch(`/api/boards/${board.id}`, {
    data: { action: "archive" }
  });
  expect(archived.status()).toBe(200);
  const restored = await page.request.patch(`/api/boards/${board.id}`, {
    data: { action: "restore" }
  });
  expect(restored.status()).toBe(200);
  await page.goto(`/boards/${board.id}`);
  await expect(page.getByRole("heading", { name: boardName })).toBeVisible();
  await expect(page.locator(".react-flow__edge")).toHaveCount(2);
});
