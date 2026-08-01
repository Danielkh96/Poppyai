export interface SignedObjectRequest {
  readonly workspaceId: string;
  readonly objectKey: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: string;
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
  get(workspaceId: string, objectKey: string): Promise<Uint8Array>;
  getRange(
    workspaceId: string,
    objectKey: string,
    start: number,
    endInclusive: number
  ): Promise<Uint8Array>;
  delete(workspaceId: string, objectKey: string): Promise<void>;
}
