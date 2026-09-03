import {
  getActivePersistBackend,
  getConfiguredDataDir,
  getLastBootRecovery,
  getStore,
  getStorePath,
  peekStoreProjectCount,
  refreshStorageHealthProbe,
  storeFileExists,
} from "./store";
import type { StorageHealth } from "./storage-health";
import type { AppStore } from "./types";
import { isPostgresConfigured } from "./store-postgres";
import { getWorkspaceFromStore } from "./services";

export type StorageDiagnostics = StorageHealth & {
  storeExists: boolean;
  storePath: string;
  projectCount: number;
  lastBoot: string;
  storeReadError?: string;
};

export type SharedStoreCatalog = {
  store: AppStore;
  storeExists: boolean;
  storePath: string;
  storeReadError?: string;
  peekProjectCount?: number;
  loadedProjectCount: number;
  listableProjectCount: number;
};

/** Load store once for list + health — list and get must agree on this snapshot. */
export async function loadSharedStoreCatalog(): Promise<SharedStoreCatalog> {
  const storePath = getStorePath();
  const storeExists = await storeFileExists();
  let storeReadError: string | undefined;
  let peekProjectCount: number | undefined;

  try {
    peekProjectCount = await peekStoreProjectCount();
  } catch (err) {
    storeReadError = err instanceof Error ? err.message : String(err);
  }

  if (!isPostgresConfigured() && !storeExists) {
    storeReadError =
      storeReadError ??
      `ENOENT: no such file or directory, access '${storePath}'`;
  }

  const store = await getStore();
  const loadedProjectCount = store.projects.length;
  const listableProjectCount = store.projects.filter((p) =>
    getWorkspaceFromStore(store, p.id)
  ).length;

  if (listableProjectCount !== loadedProjectCount) {
    storeReadError =
      storeReadError ??
      `Catalog has ${loadedProjectCount} project row(s) but only ${listableProjectCount} can be opened`;
  }

  if (
    peekProjectCount !== undefined &&
    peekProjectCount !== loadedProjectCount
  ) {
    storeReadError =
      storeReadError ??
      `Storage index reports ${peekProjectCount} project(s) but loaded catalog has ${loadedProjectCount}`;
  }

  if (
    !isPostgresConfigured() &&
    !storeExists &&
    peekProjectCount !== undefined &&
    peekProjectCount > 0 &&
    loadedProjectCount === 0
  ) {
    storeReadError =
      storeReadError ??
      `Storage file missing but index reported ${peekProjectCount} project(s) — catalog unreadable`;
  }

  return {
    store,
    storeExists,
    storePath,
    storeReadError,
    peekProjectCount,
    loadedProjectCount,
    listableProjectCount,
  };
}

/** Shared storage view for /api/health and /api/projects — must agree. */
export async function collectStorageDiagnostics(options?: {
  includeProjectCount?: boolean;
  catalog?: SharedStoreCatalog;
}): Promise<StorageDiagnostics> {
  const dataDir = getConfiguredDataDir();
  const health = await refreshStorageHealthProbe();
  const lastBoot = getLastBootRecovery();
  const persistBackend = health.persistBackend ?? getActivePersistBackend();

  const catalog =
    options?.catalog ??
    (options?.includeProjectCount ? await loadSharedStoreCatalog() : null);

  const storePath = catalog?.storePath ?? getStorePath();
  const storeExists = catalog?.storeExists ?? await storeFileExists();
  let storeReadError = catalog?.storeReadError;
  let projectCount = 0;

  if (catalog) {
    projectCount = catalog.listableProjectCount;
  } else if (options?.includeProjectCount) {
    try {
      projectCount = await peekStoreProjectCount();
    } catch (err) {
      storeReadError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!catalog && !isPostgresConfigured() && !storeExists) {
    storeReadError =
      storeReadError ??
      `ENOENT: no such file or directory, access '${storePath}'`;
  }

  const catalogUnreadable =
    Boolean(storeReadError) ||
    (catalog &&
      catalog.listableProjectCount === 0 &&
      (catalog.loadedProjectCount > 0 ||
        (catalog.peekProjectCount ?? 0) > 0));

  const status =
    health.writeProbeOk === false || health.postgresOk === false
      ? "degraded"
      : catalogUnreadable
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
