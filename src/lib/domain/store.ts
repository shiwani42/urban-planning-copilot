import { promises as fs } from "fs";
import path from "path";
import type { AppStore } from "./types";
import { generateSyntheticCity } from "./seed";
import {
  loadSanFranciscoCity,
  syntheticSupplementDatasets,
} from "./sf-data";

function dataDir(): string {
  return process.env.DATA_DIR ?? path.join(process.cwd(), "data");
}

function storePath(): string {
  return path.join(dataDir(), "store.json");
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

export async function ensureStore(): Promise<AppStore> {
  const dir = dataDir();
  if (memory && memoryDataDir !== dir) {
    memory = null;
  }
  if (memory) return memory;
  await fs.mkdir(dir, { recursive: true });
  const pathToStore = storePath();
  try {
    const raw = await fs.readFile(pathToStore, "utf8");
    memory = JSON.parse(raw) as AppStore;
    memoryDataDir = dir;
    if (!memory.proposals) memory.proposals = [];
    const catalog = await catalogTemplate();
    if (!memory.datasets?.length || !memory.featuresByDataset) {
      memory.datasets = catalog.datasets;
      memory.featuresByDataset = catalog.featuresByDataset;
      await persist(memory);
    } else {
      let upgraded = false;
      for (const ds of catalog.datasets) {
        if (!memory.datasets.some((d) => d.kind === ds.kind)) {
          memory.datasets.push(ds);
          memory.featuresByDataset[ds.id] = catalog.featuresByDataset[ds.id];
          upgraded = true;
        }
      }
      if (upgraded) await persist(memory);
    }
    return memory;
  } catch {
    memory = await buildDefaultStore();
    memoryDataDir = dir;
    await persist(memory);
    return memory;
  }
}

export async function getStore(): Promise<AppStore> {
  return ensureStore();
}

/** Re-read store.json from disk — ensures GET handlers see persisted WebMCP mutations. */
export async function reloadStoreFromDisk(): Promise<AppStore> {
  memory = null;
  memoryDataDir = null;
  return ensureStore();
}

export async function persist(store: AppStore): Promise<void> {
  const dir = dataDir();
  const pathToStore = storePath();
  memory = store;
  memoryDataDir = dir;
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${pathToStore}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(tmp, pathToStore);
  });
  await writeQueue;
}

export async function updateStore(
  mutator: (store: AppStore) => void | Promise<void>
): Promise<AppStore> {
  const store = await ensureStore();
  await mutator(store);
  await persist(store);
  return store;
}

export async function resetStore(): Promise<AppStore> {
  memory = null;
  memoryDataDir = null;
  memory = await buildDefaultStore();
  memoryDataDir = dataDir();
  await persist(memory);
  return memory;
}

export function getStorePath(): string {
  return storePath();
}
