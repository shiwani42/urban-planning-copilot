export type BootRecoveryKind =
  | "first-run"
  | "recovered-backup"
  | "empty-after-missing-file"
  | "migrated-from-legacy-path"
  | "normal";

export type StorageHealth = {
  status: "healthy" | "degraded" | "unknown";
  dataDir: string;
  configuredDataDir: string;
  onPersistentMount: boolean;
  /** Latest write-probe outcome — false when the data dir is not writable. */
  writeProbeOk?: boolean;
  /** How the in-process store was bootstrapped — surfaces deploy/mount recovery. */
  lastBoot?: BootRecoveryKind;
  message?: string;
  checkedAt: string;
};

const healthByDir = new Map<string, StorageHealth>();

const PERSISTENT_MOUNT_PREFIXES = [
  "/var/data",
  process.env.RENDER_DATA_DIR_PREFIX ?? "/opt/render/project/src/data",
];

export function getRenderDiskPrefix(): string {
  return process.env.RENDER_DATA_DIR_PREFIX ?? "/var/data";
}

function onPersistentMount(dataDir: string): boolean {
  return PERSISTENT_MOUNT_PREFIXES.some(
    (prefix) => dataDir === prefix || dataDir.startsWith(`${prefix}/`)
  );
}

export function markStorageHealthy(
  dataDir: string,
  message?: string,
  options?: { writeProbeOk?: boolean; lastBoot?: BootRecoveryKind }
): void {
  const previous = healthByDir.get(dataDir);
  healthByDir.set(dataDir, {
    status: "healthy",
    dataDir,
    configuredDataDir: dataDir,
    onPersistentMount: onPersistentMount(dataDir),
    writeProbeOk: options?.writeProbeOk ?? true,
    lastBoot: options?.lastBoot ?? previous?.lastBoot ?? "normal",
    message,
    checkedAt: new Date().toISOString(),
  });
}

export function markStorageDegraded(
  dataDir: string,
  message: string,
  options?: { writeProbeOk?: boolean; lastBoot?: BootRecoveryKind }
): void {
  const previous = healthByDir.get(dataDir);
  healthByDir.set(dataDir, {
    status: "degraded",
    dataDir,
    configuredDataDir: dataDir,
    onPersistentMount: onPersistentMount(dataDir),
    writeProbeOk: options?.writeProbeOk ?? false,
    lastBoot: options?.lastBoot ?? previous?.lastBoot ?? "normal",
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
      onPersistentMount: onPersistentMount(dataDir),
      checkedAt: new Date().toISOString(),
    }
  );
}
