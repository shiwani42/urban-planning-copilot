import { randomBytes } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { AppStore } from "./types";
import {
  hydrateAnalysisResultsInStore,
  prepareAnalysisResultsInStore,
  prepareStoreForPersistence,
} from "./store-persistence";
import { reconcileInterruptedAnalysisJobsOnBoot } from "./analysis-jobs";
import { dedupeAnalysisResultsPerScenario } from "./analysis-candidates";
import { compactLegacyStoreJsonBeforeParse } from "./store-legacy-compact";
import { normalizeStoreShape } from "./store-shape";
import { generateSyntheticCity } from "./seed";
import {
  attachSanFranciscoSnapshotLayers,
  loadSanFranciscoCity,
  syntheticSupplementDatasets,
} from "./sf-data";
import {
  getStorageHealth,
  markStorageDegraded,
  markStorageHealthy,
  type BootRecoveryKind,
  type PersistBackend,
  type StorageHealth,
} from "./storage-health";
import {
  getPersistBackend,
  isPostgresConfigured,
  loadStorePayloadFromPostgres,
  patchPostgresDocuments,
  peekPostgresProjectCount,
  PostgresPersistError,
  upsertStoreToPostgres,
  verifyPostgresWritable,
} from "./store-postgres";
import {
  isRealMount,
  legacyRenderDataDir,
  resolveDataDir,
  storeSearchDirs,
} from "./storage-mount";
import { projectCountFromRawJson } from "./store-shape";

const DEFAULT_DISK_READ_RETRY_DELAYS_MS = [2000, 3000, 5000];

function diskReadRetryDelays(): number[] {
  const raw = process.env.STORE_DISK_READ_RETRY_MS;
  if (raw) {
    const parsed = raw
      .split(",")
      .map((part) => Number.parseInt(part.trim(), 10))
      .filter((n) => Number.isFinite(n) && n >= 0);
    if (parsed.length > 0) return parsed;
  }
  return DEFAULT_DISK_READ_RETRY_DELAYS_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPersistentDataDir(dir: string): boolean {
  const prefixes = [
    legacyRenderDataDir(),
    "/var/data",
    process.env.RENDER_DATA_DIR_PREFIX ?? legacyRenderDataDir(),
  ].filter((prefix, index, all) => all.indexOf(prefix) === index);
  return prefixes.some(
    (prefix) => dir === prefix || dir.startsWith(`${prefix}/`)
  );
}

export type PersistOptions = {
  /** Allow replacing a non-empty on-disk catalog with zero projects (tests / explicit wipe). */
  allowEmptyCatalog?: boolean;
  /**
   * `documents` patches projects/scenarios/activity without rewriting
   * analysisResults or GIS catalog features (postgres jsonb merge).
   * `full` (default) writes the compact catalog including analysis rows.
   */
  scope?: "full" | "documents";
};

/** Persist planner documents without rewriting analysis payloads or GIS features. */
export const DOCUMENT_PERSIST: PersistOptions = { scope: "documents" };

let lastBootRecovery: BootRecoveryKind = "normal";

export function getLastBootRecovery(): BootRecoveryKind {
  return lastBootRecovery;
}

let resolvedDataDirCache: string | null = null;

export function resetDataDirCacheForTests(): void {
  resolvedDataDirCache = null;
}

export async function ensureDataDirResolved(): Promise<string> {
  if (resolvedDataDirCache) return resolvedDataDirCache;
  resolvedDataDirCache = await resolveDataDir();
  return resolvedDataDirCache;
}

export function resetMigrationAttemptedForTests(): void {
  migrationAttempted = false;
  lastBootRecovery = "normal";
  resolvedDataDirCache = null;
}

function setLastBootRecovery(kind: BootRecoveryKind): void {
  lastBootRecovery = kind;
}

function dataDir(): string {
  return (
    resolvedDataDirCache ??
    process.env.DATA_DIR ??
    path.join(process.cwd(), "data")
  );
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
let persistFailureInjector: (() => void) | null = null;
let migrationAttempted = false;

export class StorePersistError extends Error {
  readonly code = "STORE_PERSIST_FAILED" as const;
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "StorePersistError";
    if (options?.cause) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Test hook — throw before renaming tmp → store.json */
export function setPersistFailureInjector(fn: (() => void) | null): void {
  persistFailureInjector = fn;
}

export async function storeFileExists(): Promise<boolean> {
  return fileExists(storePath());
}

/** Read project count from disk without bootstrapping or persisting an empty store. */
export async function peekStoreProjectCount(): Promise<number> {
  if (isPostgresConfigured()) {
    try {
      const count = await peekPostgresProjectCount();
      return count ?? 0;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
  }
  const pathToStore = storePath();
  if (!(await fileExists(pathToStore))) {
    return 0;
  }
  const raw = await fs.readFile(pathToStore, "utf8");
  if (!raw.trim()) {
    throw new Error("store.json is empty");
  }
  const parsed = JSON.parse(raw) as { projects?: unknown };
  if (!Array.isArray(parsed.projects)) {
    throw new Error("Refusing to read store.json: projects field is not an array");
  }
  return parsed.projects.length;
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function projectCountInFile(file: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return projectCountFromRawJson(raw);
  } catch {
    return null;
  }
}

async function maxProjectCountOnDisk(
  pathToStore: string,
  pathToBackup: string
): Promise<number> {
  const counts = await Promise.all([
    projectCountInFile(pathToStore),
    projectCountInFile(pathToBackup),
    projectCountInFile(`${pathToStore}.tmp`),
  ]);
  return Math.max(0, ...counts.filter((c): c is number => c !== null));
}

async function hasPriorCatalogEvidence(
  pathToStore: string,
  pathToBackup: string
): Promise<boolean> {
  if (await fileExists(pathToStore)) return true;
  if (await fileExists(pathToBackup)) return true;
  if (await fileExists(`${pathToStore}.tmp`)) return true;
  return (await maxProjectCountOnDisk(pathToStore, pathToBackup)) > 0;
}

async function waitForStoreFilesOnDisk(
  pathToStore: string,
  pathToBackup: string
): Promise<"primary" | "backup" | "none"> {
  for (let attempt = 0; attempt <= diskReadRetryDelays().length; attempt++) {
    if (await fileExists(pathToStore)) return "primary";
    if (await fileExists(pathToBackup)) return "backup";
    const delays = diskReadRetryDelays();
    if (attempt < delays.length) {
      const delayMs = delays[attempt]!;
      console.error(
        `[store] store.json and backup missing — waiting ${delayMs}ms for disk mount (attempt ${attempt + 1}/${delays.length})`
      );
      await sleep(delayMs);
    }
  }
  return "none";
}

async function assertNotClobberingNonemptyCatalog(
  pathToStore: string,
  pathToBackup: string,
  store: AppStore,
  options?: PersistOptions
): Promise<void> {
  if (options?.allowEmptyCatalog) return;
  if (store.projects.length > 0) return;
  const existingCount = await maxProjectCountOnDisk(pathToStore, pathToBackup);
  if (existingCount > 0) {
    const message = `Refusing to persist empty catalog over disk store with ${existingCount} project(s)`;
    console.error(`[store] ${message}`);
    throw new StorePersistError(message);
  }
}

type ParsedStoreFile = { store: AppStore; legacyCompacted: boolean };

async function parseStoreFile(raw: string, source: string): Promise<ParsedStoreFile> {
  const { raw: compactRaw, changed: legacyCompacted } = compactLegacyStoreJsonBeforeParse(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(compactRaw);
  } catch (err) {
    throw new Error(
      `Failed to parse ${source}: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Failed to parse ${source}: expected JSON object`);
  }
  const rawProjects = (parsed as { projects?: unknown }).projects;
  if ("projects" in (parsed as object) && !Array.isArray(rawProjects)) {
    throw new Error(`Refusing to load ${source}: projects field is not an array`);
  }
  const rawProjectCount = Array.isArray(rawProjects) ? rawProjects.length : null;
  const normalized = normalizeStoreShape(
    parsed as Partial<AppStore> & Record<string, unknown>
  );
  if (rawProjectCount !== null && rawProjectCount > 0 && normalized.projects.length === 0) {
    throw new Error(
      `Refusing to load ${source}: store upgrade would drop ${rawProjectCount} project(s)`
    );
  }
  return { store: normalized, legacyCompacted };
}

/**
 * Copy store.json (or .bak) from the legacy Render mount into DATA_DIR when the
 * new path is empty. Old files are kept until the copy parses successfully.
 */
export async function migrateStoreFromLegacyPaths(): Promise<boolean> {
  await ensureDataDirResolved();
  const targetDir = dataDir();
  const targetStore = path.join(targetDir, "store.json");
  if (await fileExists(targetStore)) {
    return false;
  }

  const candidates = storeSearchDirs(targetDir).filter((dir) => dir !== targetDir);

  for (const legacyDir of candidates) {
    for (const fileName of ["store.json", "store.json.bak"] as const) {
      const legacyPath = path.join(legacyDir, fileName);
      if (!(await fileExists(legacyPath))) continue;
      try {
        const raw = await fs.readFile(legacyPath, "utf8");
        if (!raw.trim()) continue;
        await parseStoreFile(raw, legacyPath).then((p) => p.store);
        await fs.mkdir(targetDir, { recursive: true });
        const destName =
          fileName === "store.json.bak" ? "store.json.bak" : "store.json";
        const destPath = path.join(targetDir, destName);
        await fs.copyFile(legacyPath, destPath);
        if (destName === "store.json") {
          setLastBootRecovery("migrated-from-legacy-path");
          return true;
        }
      } catch {
        /* try next legacy candidate */
      }
    }
  }

  return false;
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

async function safeUnlinkProbe(file: string): Promise<void> {
  try {
    await fs.unlink(file);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") throw err;
  }
}

/** Write+unlink a unique probe file — safe under concurrent health/persist checks. */
export async function verifyWritableDataDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const probe = path.join(
    dir,
    `.write-probe-${process.pid}-${randomBytes(8).toString("hex")}`
  );
  await fs.writeFile(probe, "ok", "utf8");
  await safeUnlinkProbe(probe);
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await fs.open(filePath, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function backupPrimaryIfValid(
  pathToStore: string,
  pathToBackup: string
): Promise<void> {
  if (!(await fileExists(pathToStore))) return;
  try {
    const raw = await fs.readFile(pathToStore, "utf8");
    if (!raw.trim()) return;
    await parseStoreFile(raw, pathToStore).then((p) => p.store);
    await fs.copyFile(pathToStore, pathToBackup);
  } catch {
    /* keep existing .bak when primary is unreadable */
  }
}

async function writeStorePayload(
  dir: string,
  pathToStore: string,
  pathToBackup: string,
  store: AppStore,
  options?: PersistOptions
): Promise<void> {
  await assertNotClobberingNonemptyCatalog(pathToStore, pathToBackup, store, options);
  const payload = JSON.stringify(prepareStoreForPersistence(store), null, 2);
  const tmp = `${pathToStore}.tmp`;
  await fs.writeFile(tmp, payload, "utf8");
  await syncFile(tmp);

  const tmpRaw = await fs.readFile(tmp, "utf8");
  if (!tmpRaw.trim()) {
    await fs.unlink(tmp).catch(() => undefined);
    throw new StorePersistError("Refusing to persist empty store payload");
  }
  await parseStoreFile(tmpRaw, tmp).then((p) => p.store);

  persistFailureInjector?.();

  try {
    await backupPrimaryIfValid(pathToStore, pathToBackup);
    await fs.rename(tmp, pathToStore);
    await syncFile(pathToStore);
    await fs.copyFile(pathToStore, pathToBackup);
    await syncFile(pathToBackup);
  } catch (err) {
    if (await fileExists(tmp)) {
      await fs.unlink(tmp).catch(() => undefined);
    }
    throw err instanceof StorePersistError
      ? err
      : new StorePersistError(
          err instanceof Error ? err.message : String(err),
          { cause: err }
        );
  }
}

async function findBackupAcrossSearchPaths(
  resolvedDir: string
): Promise<{ dir: string; backupPath: string } | null> {
  for (const dir of storeSearchDirs(resolvedDir)) {
    const backupPath = path.join(dir, "store.json.bak");
    if (!(await fileExists(backupPath))) continue;
    try {
      const raw = await fs.readFile(backupPath, "utf8");
      if (!raw.trim()) continue;
      await parseStoreFile(raw, backupPath).then((p) => p.store);
      return { dir, backupPath };
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

async function restoreStoreFromBackup(
  dir: string,
  pathToStore: string,
  pathToBackup: string,
  message: string
): Promise<AppStore> {
  const raw = await fs.readFile(pathToBackup, "utf8");
  const { store, legacyCompacted } = await parseStoreFile(raw, pathToBackup);
  const interrupted = reconcileInterruptedAnalysisJobsOnBoot(store);
  prepareAnalysisResultsInStore(store);
  const upgraded = await upgradeCatalog(store);
  setLastBootRecovery("recovered-backup");
  if (legacyCompacted || interrupted || upgraded) {
    await persist(store);
  } else {
    await writeStorePayload(dir, pathToStore, pathToBackup, store);
  }
  memory = store;
  memoryDataDir = dir;
  markStorageHealthy(dir, message, { lastBoot: "recovered-backup" });
  console.error(`[store] ${message}`);
  return store;
}

async function ensureMigrated(): Promise<void> {
  if (migrationAttempted) return;
  migrationAttempted = true;
  await migrateStoreFromLegacyPaths();
}

function postgresHealthOptions(
  overrides?: Partial<{
    writeProbeOk: boolean;
    lastBoot: BootRecoveryKind;
    postgresOk: boolean;
  }>
): {
  persistBackend: PersistBackend;
  postgresOk: boolean;
  writeProbeOk: boolean;
  lastBoot?: BootRecoveryKind;
} {
  return {
    persistBackend: "postgres",
    postgresOk: overrides?.postgresOk ?? true,
    writeProbeOk: overrides?.writeProbeOk ?? true,
    ...(overrides?.lastBoot ? { lastBoot: overrides.lastBoot } : {}),
  };
}


async function readStoreFromPostgresPrimary(): Promise<AppStore> {
  await ensureDataDirResolved();
  const dir = dataDir();
  const pathToStore = storePath();
  const pathToBackup = backupPath();

  try {
    const raw = await loadStorePayloadFromPostgres();
    if (raw !== null) {
      const { store, legacyCompacted } = await parseStoreFile(raw, "postgres:planning_store");
      const interrupted = reconcileInterruptedAnalysisJobsOnBoot(store);
      prepareAnalysisResultsInStore(store);
      const deduped = dedupeAnalysisResultsPerScenario(store);
      const upgraded = await upgradeCatalog(store);
      setLastBootRecovery("normal");
      markStorageHealthy(dir, undefined, {
        ...postgresHealthOptions({ lastBoot: "normal" }),
      });
      if (legacyCompacted || interrupted || deduped || upgraded) {
        await persist(store);
      }
      return store;
    }

    const store = await buildDefaultStore();
    setLastBootRecovery("first-run");
    try {
      await persist(store, { allowEmptyCatalog: true });
      markStorageHealthy(dir, undefined, {
        ...postgresHealthOptions({ lastBoot: "first-run" }),
      });
    } catch (err) {
      markStorageDegraded(
        dir,
        err instanceof Error ? err.message : String(err),
        {
          ...postgresHealthOptions({
            lastBoot: "first-run",
            postgresOk: false,
            writeProbeOk: false,
          }),
        }
      );
      throw err;
    }
    return store;
  } catch (err) {
    if (err instanceof StorePersistError || err instanceof PostgresPersistError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    setLastBootRecovery("empty-after-missing-file");
    markStorageDegraded(dir, `Postgres read failed: ${message}`, {
      ...postgresHealthOptions({
        lastBoot: "empty-after-missing-file",
        postgresOk: false,
        writeProbeOk: false,
      }),
    });
    throw err;
  }
}

async function readStoreFromDisk(): Promise<AppStore> {
  if (isPostgresConfigured()) {
    return readStoreFromPostgresPrimary();
  }

  await ensureDataDirResolved();
  const dir = dataDir();
  await ensureMigrated();

  const pathToStore = storePath();
  const pathToBackup = backupPath();

  if (await fileExists(pathToStore)) {
    try {
      const raw = await fs.readFile(pathToStore, "utf8");
      if (!raw.trim()) {
        throw new Error("store.json is empty");
      }
      const { store, legacyCompacted } = await parseStoreFile(raw, pathToStore);
      const interrupted = reconcileInterruptedAnalysisJobsOnBoot(store);
      prepareAnalysisResultsInStore(store);
      const upgraded = await upgradeCatalog(store);
      setLastBootRecovery("normal");
      markStorageHealthy(dir, undefined, { lastBoot: "normal" });
      if (legacyCompacted || interrupted || upgraded) {
        await persist(store);
      }
      return store;
    } catch (primaryErr) {
      if (await fileExists(pathToBackup)) {
        try {
          return await restoreStoreFromBackup(
            dir,
            pathToStore,
            pathToBackup,
            "Recovered workspace from backup after primary store read failed."
          );
        } catch {
          /* fall through */
        }
      }
      setLastBootRecovery("empty-after-missing-file");
      markStorageDegraded(
        dir,
        primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
      );
      throw primaryErr;
    }
  }

  if (await fileExists(pathToBackup)) {
    return restoreStoreFromBackup(
      dir,
      pathToStore,
      pathToBackup,
      "Restored workspace from backup."
    );
  }

  const located = await waitForStoreFilesOnDisk(pathToStore, pathToBackup);
  if (located === "primary") {
    return readStoreFromDisk();
  }
  if (located === "backup") {
    return restoreStoreFromBackup(
      dir,
      pathToStore,
      pathToBackup,
      "Restored workspace from backup after disk mount delay."
    );
  }

  const externalBackup = await findBackupAcrossSearchPaths(dir);
  if (externalBackup) {
    return restoreStoreFromBackup(
      dir,
      pathToStore,
      externalBackup.backupPath,
      externalBackup.dir === dir
        ? "Restored workspace from backup."
        : `Restored workspace from backup at ${externalBackup.backupPath}.`
    );
  }

  const hadEvidence = await hasPriorCatalogEvidence(pathToStore, pathToBackup);
  const onPersistent = isPersistentDataDir(dir);
  const store = await buildDefaultStore();

  if (hadEvidence || onPersistent) {
    const message = hadEvidence
      ? "Store files were missing but prior catalog evidence exists — refusing to write an empty catalog."
      : "Persistent disk has no store.json after mount retries — refusing to write an empty catalog.";
    console.error(`[store] ${message}`);
    setLastBootRecovery("empty-after-missing-file");
    memory = store;
    memoryDataDir = dir;
    markStorageDegraded(dir, message, {
      writeProbeOk: true,
      lastBoot: "empty-after-missing-file",
    });
    return store;
  }

  setLastBootRecovery("first-run");
  try {
    await persist(store, { allowEmptyCatalog: true });
    markStorageHealthy(dir, undefined, { writeProbeOk: true, lastBoot: "first-run" });
  } catch (err) {
    markStorageDegraded(
      dir,
      err instanceof Error ? err.message : String(err),
      { writeProbeOk: false, lastBoot: "first-run" }
    );
    throw err;
  }
  return store;
}

/** Retry disk reads until store files appear or retries exhaust — for seed / boot. */
export async function waitForStableStoreRead(): Promise<AppStore> {
  if (isPostgresConfigured()) {
    return ensureStore();
  }

  const dir = dataDir();
  const pathToStore = storePath();
  const pathToBackup = backupPath();

  for (let attempt = 0; attempt <= diskReadRetryDelays().length; attempt++) {
    memory = null;
    memoryDataDir = null;
    try {
      const store = await readStoreFromDisk();
      if (store.projects.length > 0) {
        return store;
      }
      if ((await fileExists(pathToStore)) || (await fileExists(pathToBackup))) {
        return store;
      }
      if (attempt === diskReadRetryDelays().length) {
        return store;
      }
    } catch (err) {
      if (attempt === diskReadRetryDelays().length) {
        throw err;
      }
    }
    const delays = diskReadRetryDelays();
    const delayMs = delays[attempt]!;
    console.error(
      `[store] seed/boot waiting ${delayMs}ms for stable disk read (attempt ${attempt + 1}/${delays.length})`
    );
    await sleep(delayMs);
  }

  return ensureStore();
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
  await attachSanFranciscoSnapshotLayers(memory);
  return memory;
}

export async function getStore(): Promise<AppStore> {
  return ensureStore();
}

/** Wait for any in-flight disk write before reading store.json. */
export async function flushStoreWrites(): Promise<void> {
  try {
    await writeQueue;
  } catch {
    /* A failed persist must not block subsequent reads */
  }
}

/** Clear in-memory cache — tests and seed stability waits only. */
export function clearStoreCache(): void {
  memory = null;
  memoryDataDir = null;
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

function mapPostgresPersistError(err: unknown): never {
  if (err instanceof PostgresPersistError) {
    throw new StorePersistError(err.message, { cause: err });
  }
  throw err;
}

export async function persist(store: AppStore, options?: PersistOptions): Promise<void> {
  await ensureDataDirResolved();
  const dir = dataDir();
  const pathToStore = storePath();
  const pathToBackup = backupPath();
  memory = store;
  memoryDataDir = dir;
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
    try {
      if (isPostgresConfigured()) {
        try {
          if (options?.scope === "documents") {
            await patchPostgresDocuments(store, options);
          } else {
            await upsertStoreToPostgres(store, options);
          }
        } catch (err) {
          mapPostgresPersistError(err);
        }
        markStorageHealthy(dir, undefined, {
          ...postgresHealthOptions({ lastBoot: lastBootRecovery }),
        });
      } else {
        await verifyWritableDataDir(dir);
        await writeStorePayload(dir, pathToStore, pathToBackup, store, options);
        markStorageHealthy(dir, undefined, {
          lastBoot: lastBootRecovery,
          persistBackend: "file",
        });
      }
    } catch (err) {
      markStorageDegraded(
        dir,
        err instanceof Error ? err.message : String(err),
        isPostgresConfigured()
          ? {
              ...postgresHealthOptions({
                postgresOk: false,
                writeProbeOk: false,
              }),
            }
          : { persistBackend: "file", writeProbeOk: false }
      );
      throw err;
    }
  });
  await writeQueue;
}

async function runStoreMutation(
  mutator: (store: AppStore) => void | Promise<void>,
  options?: PersistOptions
): Promise<AppStore> {
  const dir = dataDir();
  if (memoryDataDir && memoryDataDir !== dir) {
    memory = null;
    memoryDataDir = null;
  }
  await flushStoreWrites();
  const store =
    memory && memoryDataDir === dir ? memory : await readStoreFromDisk();
  const projectCountBefore = store.projects.length;
  await mutator(store);
  try {
    await persist(store, options);
  } catch (err) {
    memory = null;
    memoryDataDir = null;
    const recovered = await readStoreFromDisk();
    if (recovered.projects.length < projectCountBefore) {
      throw new StorePersistError(
        "Persist failed and project list could not be recovered intact",
        { cause: err }
      );
    }
    throw err instanceof StorePersistError
      ? err
      : new StorePersistError(
          err instanceof Error ? err.message : String(err),
          { cause: err }
        );
  }
  return store;
}

export async function updateStore(
  mutator: (store: AppStore) => void | Promise<void>,
  options?: PersistOptions
): Promise<AppStore> {
  const scheduled = updateChain.then(
    () => runStoreMutation(mutator, options),
    () => runStoreMutation(mutator, options)
  );
  updateChain = scheduled.then(
    () => undefined as unknown as AppStore,
    () => undefined as unknown as AppStore
  );
  return scheduled;
}

export async function resetStore(): Promise<AppStore> {
  memory = null;
  memoryDataDir = null;
  migrationAttempted = false;
  resolvedDataDirCache = null;
  resetWriteQueues();
  setLastBootRecovery("first-run");
  const store = await buildDefaultStore();
  memoryDataDir = dataDir();
  await persist(store, { allowEmptyCatalog: true });
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

export function getActivePersistBackend(): PersistBackend {
  return getPersistBackend();
}

/** Run a write probe and refresh in-process storage health — used by /api/health. */
export async function refreshStorageHealthProbe(): Promise<StorageHealth> {
  await ensureDataDirResolved();
  const dir = dataDir();
  try {
    if (isPostgresConfigured()) {
      await verifyPostgresWritable();
      markStorageHealthy(dir, undefined, {
        ...postgresHealthOptions({ lastBoot: getLastBootRecovery() }),
      });
    } else {
      await verifyWritableDataDir(dir);
      await ensureMigrated();
      const exists = await storeFileExists();
      if (!exists) {
        setLastBootRecovery("empty-after-missing-file");
        markStorageDegraded(dir, "store.json missing", {
          writeProbeOk: true,
          persistBackend: "file",
          lastBoot: "empty-after-missing-file",
        });
      } else {
        markStorageHealthy(dir, undefined, { writeProbeOk: true, persistBackend: "file" });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    markStorageDegraded(
      dir,
      `Write probe failed: ${message}`,
      isPostgresConfigured()
        ? {
            ...postgresHealthOptions({
              postgresOk: false,
              writeProbeOk: false,
            }),
          }
        : { writeProbeOk: false, persistBackend: "file" }
    );
  }
  return getStorageHealth(dir);
}
