import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { ObjectStorage } from "./object-storage.js";
import { extractSource } from "./extract-source.js";

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function storageFor(bytes: Uint8Array): ObjectStorage {
  return {
    async createSignedUpload() {
      return new URL("https://storage.test/upload");
    },
    async createSignedDownload() {
      return new URL("https://storage.test/download");
    },
    async head() {
      return null;
    },
    async get() {
      return bytes;
    },
    async getRange() {
      return bytes;
    },
    async delete() {}
  };
}

describe("extractSource", () => {
  it("normalizes a verified UTF-8 upload into hashed segments with provenance", async () => {
    const bytes = new TextEncoder().encode("First research note.\n\nSecond research note.");
    const result = await extractSource(
      {
        id: "asset-1",
        workspaceId: "00000000-0000-4000-8000-000000000001",
        sourceType: "upload",
        objectKey: "workspaces/00000000-0000-4000-8000-000000000001/source",
        originalFileName: "notes.txt",
        sourceUrl: null,
        declaredMime: "text/plain",
        contentHash: hash(bytes)
      },
      { storage: storageFor(bytes) }
    );

    expect(result).toMatchObject({
      title: "notes.txt",
      sourceMime: "text/plain",
      contentHash: hash(bytes),
      extractorVersion: "siftloom-text-1",
      provenance: { originalFileName: "notes.txt" }
    });
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0]?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects bytes that do not match the upload intent checksum", async () => {
    const bytes = new TextEncoder().encode("tampered");
    await expect(
      extractSource(
        {
          id: "asset-2",
          workspaceId: "00000000-0000-4000-8000-000000000001",
          sourceType: "upload",
          objectKey: "workspaces/00000000-0000-4000-8000-000000000001/source",
          originalFileName: "notes.txt",
          sourceUrl: null,
          declaredMime: "text/plain",
          contentHash: "0".repeat(64)
        },
        { storage: storageFor(bytes) }
      )
    ).rejects.toMatchObject({ code: "checksum_mismatch", retryable: false });
  });
});
