import { promises as fs } from "fs";
import {
  getConfiguredDataDir,
  getStorePath,
  refreshStorageHealthProbe,
  reloadStoreFromDisk,
} from "@/lib/domain/store";
import { runApiHandler } from "@/lib/api-route";

export async function GET() {
  return runApiHandler(async () => {
    const dataDir = getConfiguredDataDir();
    const health = await refreshStorageHealthProbe();
    const storePath = getStorePath();
    let storeExists = false;
    let projectCount = 0;
    let storeReadError: string | undefined;

    try {
      await fs.access(storePath);
      storeExists = true;
      const store = await reloadStoreFromDisk();
      projectCount = store.projects.length;
    } catch (err) {
      storeReadError =
        err instanceof Error ? err.message : String(err);
    }

    const status =
      health.writeProbeOk === false
        ? "degraded"
        : health.status === "degraded"
          ? "degraded"
          : storeReadError && storeExists
            ? "degraded"
            : health.status;

    return {
      status,
      storage: {
        ...health,
        status,
        storeExists,
        projectCount,
        storePath,
        ...(storeReadError ? { storeReadError } : {}),
      },
    };
  });
}
