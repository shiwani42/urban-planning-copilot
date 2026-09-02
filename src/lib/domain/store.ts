import { promises as fs } from "fs";
import path from "path";
import type { AppStore } from "./types";
import { generateSyntheticCity } from "./seed";
import {
  loadSanFranciscoCity,
  syntheticSupplementDatasets,
} from "./sf-data";
import {
  getStorageHealth,
  markStorageDegraded,
  markStorageHealthy,
  type StorageHealth,
} from "./storage-health";

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

function storePath(): string {
  return path.join(dataDir(), "store.json");
}

function backupPath(): string {
  return `${storePath()}.bak`;
}

async function buildDefaultStore(): Promise<AppStore> {
  const now = new Date().toISOString();
  const sf = await loadSanFranciscoCity();
  if (sf.available) {
    const supplement = syntheticSupplementDatasets(now);
    return {
      version: 1,
      projects: [],
      scenarios: [],
      decisions: [],
      activities: [],
      confirmations: [],
      proposals: [],
      analysisJobs: [],
      analysisResults: [],
      reports: [],
      datasets: [...sf.datasets, ...supplement.datasets],
      featuresByDataset: {
        ...sf.featuresByDataset,
        ...supplement.featuresByDataset,
      },
    };
  }

  const city = generateSyntheticCity();
  return {
    version: 1,
    projects: [],
    scenarios: [],
    decisions: [],
    activities: [],
    confirmations: [],
    proposals: [],
    analysisJobs: [],
    analysisResults: [],
    reports: [],
    datasets: city.datasets,
    featuresByDataset: city.featuresByDataset,
  };
}

async function catalogTemplate(): Promise<Pick<AppStore, "datasets" | "featuresByDataset">> {
  const store = await buildDefaultStore();
  return { datasets: store.datasets, featuresByDataset: store.featuresByDataset };
}

let memory: AppStore | null = null;
let memoryDataDir: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();
let updateChain: Promise<AppStore> = Promise.resolve(null as unknown as AppStore);

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function parseStoreFile(raw: string, source: string): Promise<AppStore> {
  try {
    return JSON.parse(raw) as AppStore;
  } catch (err) {
    throw new Error(
      `Failed to parse ${source}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

async function upgradeCatalog(store: AppStore): Promise<boolean> {
  if (!store.proposals) store.proposals = [];
  const catalog = await catalogTemplate();
  if (!store.datasets?.length || !store.featuresByDataset) {
    store.datasets = catalog.datasets;
    store.featuresByDataset = catalog.featuresByDataset;
    return true;
  }
  let upgraded = false;
  for (const ds of catalog.datasets) {
    if (!store.datasets.some((d) => d.kind === ds.kind)) {
      store.datasets.push(ds);
      store.featuresByDataset[ds.id] = catalog.featuresByDataset[ds.id];
      upgraded = true;
    }
  }
  return upgraded;
}

async function verifyWritableDataDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(dir, ".write-probe");
  await fs.writeFile(probe, "ok", "utf8");
  await fs.unlink(probe);
}

async function readStoreFromDisk(): Promise<AppStore> {
  const dir = dataDir();
  await verifyWritableDataDir(dir);
  const pathToStore = storePath();
  const pathToBackup = backupPath();

  if (await fileExists(pathToStore)) {
    try {
      const raw = await fs.readFile(pathToStore, "utf8");
      if (!raw.trim()) {
        throw new Error("store.json is empty");
      }
      const store = await parseStoreFile(raw, pathToStore);
      const upgraded = await upgradeCatalog(store);
      markStorageHealthy(dir);
      if (upgraded) await persist(store);
      return store;
    } catch (primaryErr) {
      if (await fileExists(pathToBackup)) {
        try {
          const raw = await fs.readFile(pathToBackup, "utf8");
          const store = await parseStoreFile(raw, pathToBackup);
          await upgradeCatalog(store);
          await persist(store);
          markStorageHealthy(dir, "Recovered workspace from backup after primary store read failed.");
          return store;
        } catch {
          /* fall through */
        }
      }
      markStorageDegraded(
        dir,
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      );
      throw primaryErr;
    }
  }

  if (await fileExists(pathToBackup)) {
    const raw = await fs.readFile(pathToBackup, "utf8");
    const store = await parseStoreFile(raw, pathToBackup);
    await upgradeCatalog(store);
    await persist(store);
    markStorageHealthy(dir, "Restored workspace from backup.");
    return store;
  }

  const store = await buildDefaultStore();
  await persist(store);
  markStorageHealthy(dir);
  return store;
}

export async function ensureStore(): Promise<AppStore> {
  const dir = dataDir();
  if (memory && memoryDataDir !== dir) {
    memory = null;
    memoryDataDir = null;
  }
  if (memory) return memory;
  memory = await readStoreFromDisk();
  memoryDataDir = dir;
  return memory;
}

export async function getStore(): Promise<AppStore> {
  return ensureStore();
}

/** Wait for any in-flight disk write before reading store.json. */
export async function flushStoreWrites(): Promise<void> {
  await writeQueue;
}

/** Re-read store.json from disk — ensures handlers see the latest persisted state. */
export async function reloadStoreFromDisk(): Promise<AppStore> {
  await flushStoreWrites();
  memory = null;
  memoryDataDir = null;
  return ensureStore();
}

function resetWriteQueues(): void {
  writeQueue = Promise.resolve();
  updateChain = Promise.resolve(null as unknown as AppStore);
}

export async function persist(store: AppStore): Promise<void> {
  const dir = dataDir();
  const pathToStore = storePath();
  const pathToBackup = backupPath();
  memory = store;
  memoryDataDir = dir;
  writeQueue = writeQueue.then(async () => {
    try {
      await verifyWritableDataDir(dir);
      const payload = JSON.stringify(store, null, 2);
      const tmp = `${pathToStore}.tmp`;
      await fs.writeFile(tmp, payload, "utf8");
      if (await fileExists(pathToStore)) {
        await fs.copyFile(pathToStore, pathToBackup);
      }
      await fs.rename(tmp, pathToStore);
      await fs.copyFile(pathToStore, pathToBackup);
      markStorageHealthy(dir);
    } catch (err) {
      markStorageDegraded(
        dir,
        err instanceof Error ? err.message : String(err)
      );
      throw err;
    }
  });
  await writeQueue;
}

export async function updateStore(
  mutator: (store: AppStore) => void | Promise<void>
): Promise<AppStore> {
  const dir = dataDir();
  updateChain = updateChain.then(async () => {
    if (memoryDataDir && memoryDataDir !== dir) {
      memory = null;
      memoryDataDir = null;
    }
    const store = await reloadStoreFromDisk();
    await mutator(store);
    await persist(store);
    return store;
  });
  return updateChain;
}

export async function resetStore(): Promise<AppStore> {
  memory = null;
  memoryDataDir = null;
  resetWriteQueues();
  const store = await buildDefaultStore();
  memoryDataDir = dataDir();
  await persist(store);
  return store;
}

export function getStorePath(): string {
  return storePath();
}

export function getConfiguredDataDir(): string {
  return dataDir();
}

export function readStorageHealth(): StorageHealth {
  return getStorageHealth(dataDir());
}
