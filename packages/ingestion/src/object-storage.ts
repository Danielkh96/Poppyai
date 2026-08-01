export interface SignedObjectRequest {
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly expiresInSeconds: number;
}

export interface StoredObjectMetadata {
  readonly objectKey: string;
  readonly contentLength: number;
  readonly contentType: string;
  readonly checksumSha256: string;
}

export interface ObjectStorage {
  createSignedUpload(request: SignedObjectRequest): Promise<URL>;
  createSignedDownload(
    workspaceId: string,
    objectKey: string,
    expiresInSeconds: number
  ): Promise<URL>;
  head(workspaceId: string, objectKey: string): Promise<StoredObjectMetadata | null>;
  delete(workspaceId: string, objectKey: string): Promise<void>;
}
