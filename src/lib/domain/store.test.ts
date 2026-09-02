import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import {
  getStorePath,
  reloadStoreFromDisk,
  resetStore,
  updateStore,
} from "./store";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 600 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("store persistence", () => {
  let tmpDir: string;
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-store-"));
    previousDataDir = process.env.DATA_DIR;
    process.env.DATA_DIR = tmpDir;
    await resetStore();
  });

  afterEach(async () => {
    process.env.DATA_DIR = tmpDir;
    await resetStore();
    process.env.DATA_DIR = previousDataDir;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("serializes concurrent updates without losing projects", async () => {
    const first = await services.createProject({
      name: "Concurrent A",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await Promise.all([
      services.renameProject(first.project.id, "Concurrent A renamed"),
      services.recordProjectOpen(first.project.id),
      services.createProject({
        name: "Concurrent B",
        objectiveText: HOUSING_OBJECTIVE,
      }),
    ]);
    const store = await reloadStoreFromDisk();
    assert.equal(store.projects.length, 2);
    const listed = await services.listProjects();
    assert.equal(listed.length, 2);
  });

  it("recovers from backup when primary store.json is corrupt", async () => {
    const ws = await services.createProject({
      name: "Backup test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const storePath = getStorePath();
    await fs.writeFile(storePath, "{not-json", "utf8");
    const reloaded = await reloadStoreFromDisk();
    assert.ok(reloaded.projects.some((p) => p.id === ws.project.id));
  });

  it("does not recreate an empty store when store.json exists but is temporarily unreadable", async () => {
    await services.createProject({
      name: "Should survive",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const storePath = getStorePath();
    const backupPath = `${storePath}.bak`;
    await fs.copyFile(storePath, backupPath);
    await fs.writeFile(storePath, "", "utf8");
    const reloaded = await reloadStoreFromDisk();
    assert.equal(reloaded.projects.length, 1);
    assert.equal(reloaded.projects[0]?.name, "Should survive");
  });

  it("reloadStoreFromDisk returns data written by updateStore", async () => {
    const ws = await services.createProject({
      name: "Disk round trip",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await updateStore((store) => {
      const project = store.projects.find((p) => p.id === ws.project.id);
      if (project) project.resumeNote = "mutated on disk";
    });
    const fresh = await reloadStoreFromDisk();
    assert.equal(fresh.projects[0]?.resumeNote, "mutated on disk");
  });
});

describe("transit threshold normalization", () => {
  it("clamps unrealistic UI values", async () => {
    const { normalizeTransitThresholdMeters } = await import("./transit-threshold");
    const extreme = normalizeTransitThresholdMeters(4000);
    assert.equal(extreme.meters, 2400);
    assert.match(extreme.warning ?? "", /bike-access/i);
    const walk = normalizeTransitThresholdMeters(1500);
    assert.equal(walk.meters, 1500);
    assert.match(walk.warning ?? "", /walk distance/i);
  });
});
