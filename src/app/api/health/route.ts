import { promises as fs } from "fs";
import { readStorageHealth, getConfiguredDataDir, getStorePath } from "@/lib/domain/store";
import { runApiHandler } from "@/lib/api-route";

export async function GET() {
  return runApiHandler(async () => {
    const dataDir = getConfiguredDataDir();
    const health = readStorageHealth();
    const storePath = getStorePath();
    let storeExists = false;
    let projectCount = 0;
    try {
      await fs.access(storePath);
      storeExists = true;
      const store = await import("@/lib/domain/store").then((m) => m.reloadStoreFromDisk());
      projectCount = store.projects.length;
    } catch {
      /* unreadable */
    }
    return {
      status: health.status,
      storage: {
        ...health,
        storeExists,
        projectCount,
        storePath,
      },
    };
  });
}
