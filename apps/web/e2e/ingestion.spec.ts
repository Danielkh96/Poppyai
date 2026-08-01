import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

import { expect, test } from "@playwright/test";

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

test("uploads UTF-8 text and observes durable extraction after refresh", async ({
  browserName,
  page
}) => {
  const boardName = `M3 ingestion · ${browserName} · ${crypto.randomUUID().slice(0, 8)}`;
  const createResponse = await page.request.post("/api/boards", {
    data: { mutationId: crypto.randomUUID(), name: boardName }
  });
  expect(createResponse.status()).toBe(201);
  const { board } = (await createResponse.json()) as { board: { id: string } };

  await page.goto(`/boards/${board.id}`);
  await page.getByRole("button", { name: "PDF", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已保存", { timeout: 10_000 });

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
  await expect(page.getByLabel("节点属性")).toContainText("1 个片段");
  await page.reload();
  await page.getByLabel("语义化 Board 大纲").getByRole("button", { name: /PDF 1/ }).click();
  await expect(page.getByLabel("节点属性")).toContainText("内容已就绪", {
    timeout: 10_000
  });

  const response = await page.request.get(`/api/boards/${board.id}/ingestions`);
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    ingestions: Array<{ status: string; artifact: { segmentCount: number } | null }>;
  };
  expect(body.ingestions[0]).toMatchObject({
    status: "succeeded",
    artifact: { segmentCount: 1 }
  });
});
