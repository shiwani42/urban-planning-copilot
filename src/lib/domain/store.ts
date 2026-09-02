import { promises as fs } from "fs";
import path from "path";
import type { AppStore } from "./types";
import { generateSyntheticCity } from "./seed";

const DATA_DIR = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");

function emptyStore(): AppStore {
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
    // Ensure datasets exist (e.g. after schema upgrades)
    const city = generateSyntheticCity();
    if (!memory.datasets?.length || !memory.featuresByDataset) {
      memory.datasets = city.datasets;
      memory.featuresByDataset = city.featuresByDataset;
      await persist(memory);
    } else {
      let upgraded = false;
      for (const ds of city.datasets) {
        if (!memory.datasets.some((d) => d.kind === ds.kind)) {
          memory.datasets.push(ds);
          memory.featuresByDataset[ds.id] = city.featuresByDataset[ds.id];
          upgraded = true;
        }
      }
      if (upgraded) await persist(memory);
    }
    return memory;
  } catch {
    memory = emptyStore();
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
  memory = emptyStore();
  await persist(memory);
  return memory;
}

export function getStorePath(): string {
  return STORE_PATH;
}
