import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/*.integration.test.ts"],
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 15_000
  }
});
