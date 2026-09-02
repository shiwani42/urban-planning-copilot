export type StorageHealth = {
  status: "healthy" | "degraded" | "unknown";
  dataDir: string;
  configuredDataDir: string;
  onPersistentMount: boolean;
  /** Latest write-probe outcome — false when the data dir is not writable. */
  writeProbeOk?: boolean;
  message?: string;
  checkedAt: string;
};

const healthByDir = new Map<string, StorageHealth>();

const RENDER_DISK_PREFIX = "/opt/render/project/src/data";

export function markStorageHealthy(
  dataDir: string,
  message?: string,
  options?: { writeProbeOk?: boolean }
): void {
  healthByDir.set(dataDir, {
    status: "healthy",
    dataDir,
    configuredDataDir: dataDir,
    onPersistentMount: dataDir.startsWith(RENDER_DISK_PREFIX),
    writeProbeOk: options?.writeProbeOk ?? true,
    message,
    checkedAt: new Date().toISOString(),
  });
}

export function markStorageDegraded(
  dataDir: string,
  message: string,
  options?: { writeProbeOk?: boolean }
): void {
  healthByDir.set(dataDir, {
    status: "degraded",
    dataDir,
    configuredDataDir: dataDir,
    onPersistentMount: dataDir.startsWith(RENDER_DISK_PREFIX),
    writeProbeOk: options?.writeProbeOk ?? false,
    message,
    checkedAt: new Date().toISOString(),
  });
}

export function getStorageHealth(dataDir: string): StorageHealth {
  return (
    healthByDir.get(dataDir) ?? {
      status: "unknown",
      dataDir,
      configuredDataDir: dataDir,
      onPersistentMount: dataDir.startsWith(RENDER_DISK_PREFIX),
      checkedAt: new Date().toISOString(),
    }
  );
}
