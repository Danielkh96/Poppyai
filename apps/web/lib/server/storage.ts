import "server-only";

import {
  createS3ObjectStorageFromEnvironment,
  type ObjectStorage
} from "@siftloom/ingestion";

const storageGlobals = globalThis as typeof globalThis & {
  __siftloomStorage?: ObjectStorage;
};

export function getObjectStorage(): ObjectStorage {
  storageGlobals.__siftloomStorage ??= createS3ObjectStorageFromEnvironment();
  return storageGlobals.__siftloomStorage;
}
