import {
  getConfiguredDataDir,
  getLastBootRecovery,
  getStorePath,
  peekStoreProjectCount,
  refreshStorageHealthProbe,
  storeFileExists,
} from "./store";
import type { StorageHealth } from "./storage-health";

export type StorageDiagnostics = StorageHealth & {
  storeExists: boolean;
  storePath: string;
  projectCount: number;
  lastBoot: string;
  storeReadError?: string;
};

/** Shared storage view for /api/health and /api/projects — must agree. */
export async function collectStorageDiagnostics(options?: {
  includeProjectCount?: boolean;
}): Promise<StorageDiagnostics> {
  const dataDir = getConfiguredDataDir();
  const health = await refreshStorageHealthProbe();
  const storePath = getStorePath();
  const storeExists = await storeFileExists();
  const lastBoot = getLastBootRecovery();

  let projectCount = 0;
  let storeReadError: string | undefined;

  if (!storeExists) {
    storeReadError = `ENOENT: no such file or directory, access '${storePath}'`;
  } else if (options?.includeProjectCount) {
    try {
      projectCount = await peekStoreProjectCount();
    } catch (err) {
      storeReadError =
        err instanceof Error ? err.message : String(err);
    }
  }

  const status =
    health.writeProbeOk === false
      ? "degraded"
      : !storeExists
        ? "degraded"
        : storeReadError
          ? "degraded"
          : health.status;

  return {
    ...health,
    status,
    dataDir,
    configuredDataDir: dataDir,
    storeExists,
    storePath,
    projectCount,
    lastBoot,
    ...(storeReadError ? { storeReadError } : {}),
    ...(health.message ? { message: health.message } : {}),
  };
}
