import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

import type {
  ObjectStorage,
  SignedObjectRequest,
  StoredObjectMetadata
} from "./object-storage.js";

const storageEnvironmentSchema = z.object({
  S3_REGION: z.string().min(1),
  S3_ENDPOINT: z.url().optional(),
  S3_BUCKET: z.string().min(3),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false")
});

function assertScopedObjectKey(workspaceId: string, objectKey: string): void {
  const expectedPrefix = `workspaces/${workspaceId}/`;
  if (
    !z.uuid().safeParse(workspaceId).success ||
    !objectKey.startsWith(expectedPrefix) ||
    objectKey.includes("..") ||
    objectKey.includes("//")
  ) {
    throw new Error("Object key is outside the authorized workspace prefix");
  }
}

export class S3ObjectStorage implements ObjectStorage {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string
  ) {}

  async createSignedUpload(request: SignedObjectRequest): Promise<URL> {
    assertScopedObjectKey(request.workspaceId, request.objectKey);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: request.objectKey,
      ContentType: request.contentType,
      Metadata: {
        workspaceid: request.workspaceId,
        contentlength: String(request.contentLength),
        checksumsha256: request.checksumSha256
      }
    });
    return new URL(
      await getSignedUrl(this.client, command, { expiresIn: request.expiresInSeconds })
    );
  }

  async createSignedDownload(
    workspaceId: string,
    objectKey: string,
    expiresInSeconds: number
  ): Promise<URL> {
    assertScopedObjectKey(workspaceId, objectKey);
    return new URL(
      await getSignedUrl(
        this.client,
        new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }),
        { expiresIn: expiresInSeconds }
      )
    );
  }

  async head(workspaceId: string, objectKey: string): Promise<StoredObjectMetadata | null> {
    assertScopedObjectKey(workspaceId, objectKey);
    try {
      const response = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey })
      );
      return {
        objectKey,
        contentLength: response.ContentLength ?? 0,
        contentType: response.ContentType ?? "application/octet-stream",
        checksumSha256: response.ChecksumSHA256 ?? response.Metadata?.checksumsha256 ?? ""
      };
    } catch (error) {
      const status = (
        error as { readonly $metadata?: { readonly httpStatusCode?: number } }
      ).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw error;
    }
  }

  async get(workspaceId: string, objectKey: string): Promise<Uint8Array> {
    assertScopedObjectKey(workspaceId, objectKey);
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: objectKey })
    );
    if (!response.Body) throw new Error("Stored object has no body");
    return response.Body.transformToByteArray();
  }

  async getRange(
    workspaceId: string,
    objectKey: string,
    start: number,
    endInclusive: number
  ): Promise<Uint8Array> {
    assertScopedObjectKey(workspaceId, objectKey);
    if (start < 0 || endInclusive < start || endInclusive - start > 4_096) {
      throw new Error("Invalid bounded object range");
    }
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        Range: `bytes=${start}-${endInclusive}`
      })
    );
    if (!response.Body) throw new Error("Stored object has no body");
    return response.Body.transformToByteArray();
  }

  async delete(workspaceId: string, objectKey: string): Promise<void> {
    assertScopedObjectKey(workspaceId, objectKey);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })
    );
  }
}

export function createS3ObjectStorageFromEnvironment(
  environment: Record<string, string | undefined> = process.env
): S3ObjectStorage {
  const value = storageEnvironmentSchema.parse(environment);
  return new S3ObjectStorage(
    new S3Client({
      region: value.S3_REGION,
      ...(value.S3_ENDPOINT ? { endpoint: value.S3_ENDPOINT } : {}),
      forcePathStyle: value.S3_FORCE_PATH_STYLE === "true",
      credentials: {
        accessKeyId: value.S3_ACCESS_KEY_ID,
        secretAccessKey: value.S3_SECRET_ACCESS_KEY
      }
    }),
    value.S3_BUCKET
  );
}
