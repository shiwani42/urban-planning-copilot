import { NextResponse } from "next/server";
import { readStorageHealth, getConfiguredDataDir, getStorePath } from "@/lib/domain/store";
import { promises as fs } from "fs";

export async function GET() {
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
  return NextResponse.json({
    storage: {
      ...health,
      storeExists,
      projectCount,
      storePath,
    },
  });
}
