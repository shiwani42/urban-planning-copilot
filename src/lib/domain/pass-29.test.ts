import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import {
  getConfiguredDataDir,
  getLastBootRecovery,
  getStorePath,
  migrateStoreFromLegacyPaths,
  refreshStorageHealthProbe,
  resetMigrationAttemptedForTests,
  resetStore,
  storeFileExists,
} from "./store";
import { getSfSnapshotsDir } from "./snapshot-paths";
import { collectStorageDiagnostics } from "./storage-diagnostics";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 600 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("pass-29 production hardening", () => {
  let tmpDir: string;
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass29-"));
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = path.join(tmpDir, "var-data");
    resetMigrationAttemptedForTests();
    await resetStore();
  });

  afterEach(async () => {
    process.env.DATA_DIR = path.join(tmpDir, "var-data");
    await resetStore();
    process.env.DATA_DIR = previousDataDir;
    await fs.rm(tmpDir, { recursive: true, force: true });
    resetMigrationAttemptedForTests();
  });

  it("keeps git-tracked SF snapshots outside DATA_DIR", () => {
    const dataDir = getConfiguredDataDir();
    const sfDir = getSfSnapshotsDir();
    assert.notEqual(sfDir, dataDir);
    assert.ok(!sfDir.startsWith(dataDir));
    assert.ok(!getStorePath().includes("snapshots"));
  });

  it("persists store.json only under DATA_DIR, not under snapshots", async () => {
    await services.createProject({
      name: "DATA_DIR only",
      objectiveText: HOUSING_OBJECTIVE,
    });
    assert.equal(await storeFileExists(), true);
    assert.equal(getStorePath().startsWith(getConfiguredDataDir()), true);
    const stray = path.join(getSfSnapshotsDir(), "store.json");
    let strayExists = false;
    try {
      await fs.access(stray);
      strayExists = true;
    } catch {
      strayExists = false;
    }
    assert.equal(strayExists, false);
  });

  it("write probe does not create store.json when the catalog file is missing", async () => {
    await fs.rm(getStorePath(), { force: true });
    resetMigrationAttemptedForTests();
    const health = await refreshStorageHealthProbe();
    assert.equal(await storeFileExists(), false);
    assert.equal(getLastBootRecovery(), "empty-after-missing-file");
    assert.equal(health.status, "degraded");
    assert.equal(health.writeProbeOk, true);
  });

  it("health and projects diagnostics agree when store.json is missing", async () => {
    await fs.rm(getStorePath(), { force: true });
    resetMigrationAttemptedForTests();
    const health = await collectStorageDiagnostics({ includeProjectCount: true });
    assert.equal(health.storeExists, false);
    assert.equal(health.status, "degraded");
    assert.equal(health.lastBoot, "empty-after-missing-file");
    assert.equal(health.projectCount, 0);
    assert.match(health.storeReadError ?? "", /ENOENT/);
  });

  it("migrates store.json from legacy Render data path into DATA_DIR", async () => {
    const legacyDir = path.join(tmpDir, "legacy-render");
    const previousLegacy = process.env.LEGACY_DATA_DIR;
    process.env.LEGACY_DATA_DIR = legacyDir;
    await services.createProject({
      name: "Legacy migration",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const legacyStore = path.join(legacyDir, "store.json");
    await fs.mkdir(legacyDir, { recursive: true });
    await fs.copyFile(getStorePath(), legacyStore);
    await fs.rm(getStorePath(), { force: true });
    resetMigrationAttemptedForTests();

    try {
      const migrated = await migrateStoreFromLegacyPaths();
      assert.equal(migrated, true);
      assert.equal(await storeFileExists(), true);
      assert.equal(getLastBootRecovery(), "migrated-from-legacy-path");

      const raw = await fs.readFile(getStorePath(), "utf8");
      const parsed = JSON.parse(raw) as { projects: unknown[] };
      assert.ok(Array.isArray(parsed.projects));
      assert.equal(parsed.projects.length, 1);
    } finally {
      process.env.LEGACY_DATA_DIR = previousLegacy;
    }
  });
});
