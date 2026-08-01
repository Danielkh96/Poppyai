import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { expect, test } from "@playwright/test";

// Continuous Playwright tracing captures animated screenshots and would materially
// distort the workload (and create hundreds of MiB during the 15-minute soak).
test.use({ trace: "off", screenshot: "off", video: "off" });

interface BenchmarkResult {
  readonly durationMs: number;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly sampledFrames: number;
  readonly p95FrameTimeMs: number;
  readonly framesWithin20msPercent: number;
  readonly pointerToPaintP95Ms: number | null;
  readonly longestTaskMs: number;
  readonly stateUpdateCycles: number;
  readonly heapStartBytes: number | null;
  readonly heapEndBytes: number | null;
  readonly heapGrowthPercent: number | null;
}

interface CdpHeapUsage {
  readonly usedSize: number;
  readonly totalSize: number;
  readonly embedderHeapUsedSize?: number;
  readonly backingStorageSize?: number;
}

interface SoakHeapResult {
  readonly method: "CDP HeapProfiler.collectGarbage + Runtime.getHeapUsage";
  readonly minuteFiveUsedBytes: number;
  readonly minuteFifteenUsedBytes: number;
  readonly growthPercent: number;
  readonly benchmarkActiveDuringFinalSample: true;
}

test("records the deterministic canvas benchmark", async ({
  page,
  browser,
  browserName
}) => {
  test.setTimeout(22 * 60_000);
  const durationMs = Number(process.env.CANVAS_BENCHMARK_MS ?? 5_000);
  const isFifteenMinuteSoak = durationMs >= 15 * 60_000;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/prototype/canvas");
  await expect(page.getByTestId("canvas-surface")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__SIFTLOOM_BENCHMARK__));

  const benchmarkStartedAt = Date.now();
  const resultPromise = page.evaluate(
    async ({ duration, holdUntilFinalized }) => {
      const controller = window.__SIFTLOOM_BENCHMARK__;
      if (!controller) throw new Error("Canvas benchmark controller was not registered");
      return controller.run(duration, holdUntilFinalized);
    },
    { duration: durationMs, holdUntilFinalized: isFifteenMinuteSoak }
  );

  const box = await page.getByTestId("canvas-surface").boundingBox();
  if (!box) throw new Error("Canvas surface has no bounding box");

  const draggableNode = page.locator(".react-flow__node").first();
  const visibleNodeCount = await page.locator(".react-flow__node").count();
  expect(visibleNodeCount).toBeGreaterThanOrEqual(30);
  const nodeBox = await draggableNode.boundingBox();
  if (!nodeBox) throw new Error("The reference fixture has no visible draggable node");
  await page.mouse.move(nodeBox.x + nodeBox.width / 2, nodeBox.y + nodeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    nodeBox.x + nodeBox.width / 2 + 64,
    nodeBox.y + nodeBox.height / 2 + 36,
    {
      steps: 24
    }
  );
  await page.mouse.up();

  for (let index = 0; index < 180; index += 1) {
    const x = box.x + 100 + ((index * 13) % Math.max(120, box.width - 200));
    const y = box.y + 90 + ((index * 7) % Math.max(100, box.height - 180));
    await page.mouse.move(x, y);
  }

  let soakHeap: SoakHeapResult | null = null;
  if (isFifteenMinuteSoak) {
    if (browserName !== "chromium") {
      throw new Error("The post-GC soak measurement requires the Chromium CDP project");
    }

    const cdp = await page.context().newCDPSession(page);
    const waitUntilBenchmarkOffset = async (offsetMs: number): Promise<void> => {
      const remainingMs = benchmarkStartedAt + offsetMs - Date.now();
      if (remainingMs > 0) await page.waitForTimeout(remainingMs);
    };

    await waitUntilBenchmarkOffset(5 * 60_000);
    await cdp.send("HeapProfiler.collectGarbage");
    const minuteFive = (await cdp.send("Runtime.getHeapUsage")) as CdpHeapUsage;

    await waitUntilBenchmarkOffset(15 * 60_000);
    await cdp.send("HeapProfiler.collectGarbage");
    const minuteFifteen = (await cdp.send("Runtime.getHeapUsage")) as CdpHeapUsage;
    const benchmarkActiveDuringFinalSample = await page.evaluate(() => {
      const controller = window.__SIFTLOOM_BENCHMARK__;
      if (!controller) throw new Error("Canvas benchmark controller was not registered");
      const wasActive = controller.isRunning;
      controller.finalize();
      return wasActive;
    });
    expect(benchmarkActiveDuringFinalSample).toBe(true);
    const growthPercent =
      minuteFive.usedSize > 0
        ? ((minuteFifteen.usedSize - minuteFive.usedSize) / minuteFive.usedSize) * 100
        : 0;

    soakHeap = {
      method: "CDP HeapProfiler.collectGarbage + Runtime.getHeapUsage",
      minuteFiveUsedBytes: minuteFive.usedSize,
      minuteFifteenUsedBytes: minuteFifteen.usedSize,
      growthPercent: Number(growthPercent.toFixed(2)),
      benchmarkActiveDuringFinalSample: true
    };
    await cdp.detach();
  }

  const result = (await resultPromise) as BenchmarkResult;
  expect(result.nodeCount).toBe(200);
  expect(result.edgeCount).toBe(300);
  expect(result.sampledFrames).toBeGreaterThan(20);
  expect(result.stateUpdateCycles).toBeGreaterThan(10);
  expect(Number.isFinite(result.p95FrameTimeMs)).toBe(true);

  if (process.env.WRITE_BENCHMARK_RESULT === "1") {
    const target = resolve(
      process.cwd(),
      "../..",
      process.env.BENCHMARK_RESULT_FILE ?? "docs/performance/latest.local.json"
    );
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      `${JSON.stringify(
        {
          measuredAt: new Date().toISOString(),
          browserName,
          browserVersion: browser.version(),
          browserUserAgent: await page.evaluate(() => navigator.userAgent),
          viewport: { width: 1440, height: 900 },
          visibleNodeCount,
          result,
          soakHeap
        },
        null,
        2
      )}\n`,
      "utf8"
    );
  }
});
