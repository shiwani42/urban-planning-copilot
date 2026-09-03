import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import {
  clearStoreCache,
  getActivePersistBackend,
  getLastBootRecovery,
  getStorePath,
  refreshStorageHealthProbe,
  reloadStoreFromDisk,
  resetMigrationAttemptedForTests,
  resetStore,
  storeFileExists,
  updateStore,
} from "./store";
import {
  enableInMemoryPostgresForTests,
  resetPostgresBackendForTests,
} from "./store-postgres";
import { collectStorageDiagnostics } from "./storage-diagnostics";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 600 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("pass-34 postgres persistence", () => {
  let tmpDir: string;
  let previousDataDir: string | undefined;
  let previousDatabaseUrl: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass34-"));
    previousDataDir = process.env.DATA_DIR;
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATA_DIR = tmpDir;
    process.env.DATABASE_URL = "postgres://test:test@localhost/test";
    resetPostgresBackendForTests();
    enableInMemoryPostgresForTests();
    resetMigrationAttemptedForTests();
    await resetStore();
  });

  afterEach(async () => {
    process.env.DATA_DIR = tmpDir;
    await resetStore();
    process.env.DATA_DIR = previousDataDir;
    process.env.DATABASE_URL = previousDatabaseUrl;
    resetPostgresBackendForTests();
    resetMigrationAttemptedForTests();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("loads catalog from postgres when store.json is missing", async () => {
    await services.createProject({
      name: "Survives deploy",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await fs.rm(getStorePath(), { force: true });
    clearStoreCache();
    resetMigrationAttemptedForTests();

    const reloaded = await reloadStoreFromDisk();
    assert.equal(reloaded.projects.length, 1);
    assert.equal(getLastBootRecovery(), "normal");
    assert.equal(getActivePersistBackend(), "postgres");
  });

  it("health stays healthy when postgres has catalog but store.json is missing", async () => {
    await services.createProject({
      name: "Health probe",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await fs.rm(getStorePath(), { force: true });
    clearStoreCache();
    resetMigrationAttemptedForTests();

    const health = await refreshStorageHealthProbe();
    assert.equal(health.persistBackend, "postgres");
    assert.equal(health.postgresOk, true);
    assert.equal(health.writeProbeOk, true);
    assert.equal(health.status, "healthy");

    const diagnostics = await collectStorageDiagnostics({ includeProjectCount: true });
    assert.equal(diagnostics.storeExists, false);
    assert.equal(diagnostics.projectCount, 1);
    assert.equal(diagnostics.status, "healthy");
  });

  it("persists mutations through postgres when file cache is absent", async () => {
    const ws = await services.createProject({
      name: "Postgres round trip",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await fs.rm(getStorePath(), { force: true });
    await updateStore((store) => {
      const project = store.projects.find((p) => p.id === ws.project.id);
      if (project) project.resumeNote = "saved in postgres";
    });
    clearStoreCache();
    const reloaded = await reloadStoreFromDisk();
    assert.equal(reloaded.projects[0]?.resumeNote, "saved in postgres");
  });
});
