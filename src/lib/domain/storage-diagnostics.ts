import {
  getActivePersistBackend,
  getConfiguredDataDir,
  getLastBootRecovery,
  getStorePath,
  peekStoreProjectCount,
  refreshStorageHealthProbe,
  storeFileExists,
} from "./store";
import type { StorageHealth } from "./storage-health";
import { isPostgresConfigured } from "./store-postgres";

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
  const persistBackend = health.persistBackend ?? getActivePersistBackend();

  let projectCount = 0;
  let storeReadError: string | undefined;

  if (options?.includeProjectCount) {
    try {
      projectCount = await peekStoreProjectCount();
    } catch (err) {
      storeReadError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!isPostgresConfigured() && !storeExists) {
    storeReadError =
      storeReadError ??
      `ENOENT: no such file or directory, access '${storePath}'`;
  }

  const status =
    health.writeProbeOk === false || health.postgresOk === false
      ? "degraded"
      : persistBackend === "postgres"
        ? storeReadError
          ? "degraded"
          : health.status
        : !storeExists
          ? "degraded"
          : storeReadError
            ? "degraded"
            : health.status;

  return {
    ...health,
    persistBackend,
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
