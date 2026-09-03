import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import {
  clearStoreCache,
  ensureDataDirResolved,
  getConfiguredDataDir,
  getLastBootRecovery,
  getStorePath,
  reloadStoreFromDisk,
  resetDataDirCacheForTests,
  resetMigrationAttemptedForTests,
  resetStore,
  storeFileExists,
} from "./store";
import {
  isRealMount,
  resolveDataDir,
  setMountDetectorForTests,
} from "./storage-mount";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 600 additional homes while maximizing transit access and avoiding flood-risk areas.";

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

describe("pass-30 production hardening", () => {
  it("tracks data/.gitkeep so deploy checkout keeps the data directory", async () => {
    const gitkeep = path.join(REPO_ROOT, "data", ".gitkeep");
    await fs.access(gitkeep);
  });

  describe("DATA_DIR resolution", () => {
    let tmpDir: string;
    let previousDataDir: string | undefined;
    let previousLegacy: string | undefined;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass30-"));
      previousDataDir = process.env.DATA_DIR;
      previousLegacy = process.env.LEGACY_DATA_DIR;
      resetDataDirCacheForTests();
      resetMigrationAttemptedForTests();
    });

    afterEach(async () => {
      process.env.DATA_DIR = previousDataDir;
      process.env.LEGACY_DATA_DIR = previousLegacy;
      setMountDetectorForTests(null);
      resetDataDirCacheForTests();
      resetMigrationAttemptedForTests();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("does not assume /var/data when that path is not a real mount", async () => {
      const unmountedVar = path.join(tmpDir, "fake-var-data");
      const legacyMount = path.join(tmpDir, "legacy-mount");
      await fs.mkdir(unmountedVar, { recursive: true });
      await fs.mkdir(legacyMount, { recursive: true });

      process.env.DATA_DIR = unmountedVar;
      process.env.LEGACY_DATA_DIR = legacyMount;

      assert.equal(await isRealMount(unmountedVar), false);

      const resolved = await resolveDataDir();
      assert.equal(resolved, unmountedVar);
    });

    it("falls back from unmounted /var/data to a mounted legacy path", async () => {
      const legacyMount = path.join(tmpDir, "legacy-render");
      await fs.mkdir(legacyMount, { recursive: true });
      process.env.LEGACY_DATA_DIR = legacyMount;
      process.env.DATA_DIR = "/var/data";

      setMountDetectorForTests(async (dir) => {
        return dir === legacyMount;
      });

      const resolved = await resolveDataDir();
      assert.equal(resolved, legacyMount);
    });

    it("keeps process.env.DATA_DIR when set to the legacy Render mount path", async () => {
      const legacyMount = path.join(tmpDir, "src-data");
      await fs.mkdir(legacyMount, { recursive: true });
      process.env.DATA_DIR = legacyMount;
      process.env.LEGACY_DATA_DIR = legacyMount;

      const resolved = await resolveDataDir();
      assert.equal(resolved, legacyMount);
    });
  });

  describe("persist under resolved DATA_DIR", () => {
    let tmpDir: string;
    let previousDataDir: string | undefined;

    beforeEach(async () => {
      tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass30-store-"));
      previousDataDir = process.env.DATA_DIR;
      process.env.DATA_DIR = path.join(tmpDir, "persist-dir");
      resetDataDirCacheForTests();
      resetMigrationAttemptedForTests();
      await resetStore();
    });

    afterEach(async () => {
      process.env.DATA_DIR = path.join(tmpDir, "persist-dir");
      await resetStore();
      process.env.DATA_DIR = previousDataDir;
      resetDataDirCacheForTests();
      resetMigrationAttemptedForTests();
      await fs.rm(tmpDir, { recursive: true, force: true });
    });

    it("writes store.json only under resolved DATA_DIR", async () => {
      await services.createProject({
        name: "Pass 30 persist",
        objectiveText: HOUSING_OBJECTIVE,
      });
      const resolved = await ensureDataDirResolved();
      assert.equal(getConfiguredDataDir(), resolved);
      assert.equal(await storeFileExists(), true);
      assert.equal(getStorePath().startsWith(resolved), true);
      assert.equal(getStorePath(), path.join(resolved, "store.json"));
    });

    it("restores store.json from a .bak on the legacy path when primary is missing", async () => {
      const previousRetry = process.env.STORE_DISK_READ_RETRY_MS;
      process.env.STORE_DISK_READ_RETRY_MS = "0";
      const resolved = await ensureDataDirResolved();
      const legacyDir = path.join(tmpDir, "legacy-with-bak");
      await fs.mkdir(legacyDir, { recursive: true });
      process.env.LEGACY_DATA_DIR = legacyDir;

      await services.createProject({
        name: "Recover from legacy bak",
        objectiveText: HOUSING_OBJECTIVE,
      });
      const backup = path.join(legacyDir, "store.json.bak");
      await fs.copyFile(getStorePath(), backup);
      await fs.rm(getStorePath(), { force: true });
      resetMigrationAttemptedForTests();
      resetDataDirCacheForTests();
      clearStoreCache();

      try {
        const reloaded = await reloadStoreFromDisk();
        assert.equal(reloaded.projects.length, 1);
        assert.equal(reloaded.projects[0]?.name, "Recover from legacy bak");
        assert.equal(getLastBootRecovery(), "recovered-backup");
        assert.equal(await storeFileExists(), true);
        assert.equal(getStorePath().startsWith(resolved), true);
      } finally {
        process.env.STORE_DISK_READ_RETRY_MS = previousRetry;
      }
    });
  });
});
