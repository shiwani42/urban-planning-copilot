import { promises as fs } from "fs";
import path from "path";
import type { AppStore } from "./types";
import { generateSyntheticCity } from "./seed";
import {
  loadSanFranciscoCity,
  syntheticSupplementDatasets,
} from "./sf-data";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

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

let memory: AppStore | null = null;
let writeQueue: Promise<void> = Promise.resolve();

export async function ensureStore(): Promise<AppStore> {
  if (memory) return memory;
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    memory = JSON.parse(raw) as AppStore;
    if (!memory.proposals) memory.proposals = [];
    if (!memory.datasets?.length || !memory.featuresByDataset) {
      const fresh = await buildDefaultStore();
      memory.datasets = fresh.datasets;
      memory.featuresByDataset = fresh.featuresByDataset;
      await persist(memory);
    }
    return memory;
  } catch {
    memory = await buildDefaultStore();
    await persist(memory);
    return memory;
  }
}

export async function getStore(): Promise<AppStore> {
  return ensureStore();
}

export async function persist(store: AppStore): Promise<void> {
  memory = store;
  writeQueue = writeQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = `${STORE_PATH}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(store, null, 2), "utf8");
    await fs.rename(tmp, STORE_PATH);
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
  memory = await buildDefaultStore();
  await persist(memory);
  return memory;
}

export function getStorePath(): string {
  return STORE_PATH;
}
