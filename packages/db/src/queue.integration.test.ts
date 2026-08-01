import { randomUUID } from "node:crypto";

import { PgBoss } from "pg-boss";
import { describe, expect, it } from "vitest";

function requireTestUrl(
  name: "TEST_RUNTIME_DATABASE_URL" | "TEST_WORKER_DATABASE_URL"
): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; queue integration tests may not skip`);
  return value;
}

const webDatabaseUrl = requireTestUrl("TEST_RUNTIME_DATABASE_URL");
const workerDatabaseUrl = requireTestUrl("TEST_WORKER_DATABASE_URL");

describe("pg-boss runtime roles", () => {
  it("dispatches with the web role and consumes with the worker role", async () => {
    const sender = new PgBoss({ connectionString: webDatabaseUrl, schema: "pgboss" });
    const worker = new PgBoss({ connectionString: workerDatabaseUrl, schema: "pgboss" });
    let rejectHandled: ((reason: unknown) => void) | undefined;
    sender.on("error", (error) => rejectHandled?.(error));
    worker.on("error", (error) => rejectHandled?.(error));

    await sender.start();
    await worker.start();
    let handlingTimeout: ReturnType<typeof setTimeout> | undefined;

    try {
      const source = `integration-test:${randomUUID()}`;
      let resolveHandled: ((jobId: string) => void) | undefined;
      const handled = new Promise<string>((resolve, reject) => {
        resolveHandled = resolve;
        rejectHandled = reject;
      });
      handlingTimeout = setTimeout(
        () => rejectHandled?.(new Error("Timed out waiting for m0.health")),
        10_000
      );
      await worker.work("m0.health", async (jobs) => {
        const job = jobs[0];
        if (!job) return;
        const data = job.data as { readonly source?: string };
        if (data.source !== source) return;
        if (handlingTimeout) clearTimeout(handlingTimeout);
        resolveHandled?.(job.id);
      });

      const sentId = await sender.send("m0.health", { source });
      expect(sentId).toBeTypeOf("string");
      await expect(handled).resolves.toBe(sentId);
    } finally {
      if (handlingTimeout) clearTimeout(handlingTimeout);
      await worker.stop({ graceful: true, timeout: 10_000 });
      await sender.stop({ graceful: true, timeout: 10_000 });
    }
  });
});
