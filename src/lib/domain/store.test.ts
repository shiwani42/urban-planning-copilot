import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import {
  getStorePath,
  getStore,
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

  it("survives duplicate scenario then recalculate analysis", async () => {
    const ws = await services.createProject({
      name: "Duplicate run test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);
    const branched = await services.createScenario(
      ws.project.id,
      "Transit sensitivity",
      baselineId
    );
    const branchId = branched.scenarios.find((s) => s.name === "Transit sensitivity")!.id;
    const afterRun = await services.runAnalysis(ws.project.id, branchId);
    assert.ok(afterRun);
    assert.equal(afterRun!.scenarios.length, 2);
    const listed = await services.listProjects();
    assert.equal(listed.length, 1);
    const reloaded = await services.getWorkspace(ws.project.id);
    assert.ok(reloaded);
    assert.equal(reloaded!.scenarios.length, 2);
    const branchResult = reloaded!.analysisResults.find(
      (r) => r.id === reloaded!.scenarios.find((s) => s.id === branchId)?.latestResultId
    );
    assert.ok(branchResult);
    assert.ok(branchResult!.candidates.length > 0);
  });

  it("createProject is visible via getStore, listProjects, getWorkspace, and reload", async () => {
    const ws = await services.createProject({
      name: "Round trip create",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const projectId = ws.project.id;

    const memory = await getStore();
    assert.ok(memory.projects.some((p) => p.id === projectId));

    const listed = await services.listProjects();
    assert.ok(listed.some((p) => p.id === projectId));

    const workspace = await services.getWorkspace(projectId);
    assert.ok(workspace);
    assert.equal(workspace!.project.name, "Round trip create");

    const reloaded = await reloadStoreFromDisk();
    assert.ok(reloaded.projects.some((p) => p.id === projectId));
    assert.ok(reloaded.scenarios.some((s) => s.projectId === projectId));
  });

  it("recovers update chain after a failed mutation so create still works", async () => {
    await assert.rejects(
      () => services.renameProject("missing-project-id", "Ghost"),
      /Project not found/
    );

    const ws = await services.createProject({
      name: "After failed mutation",
      objectiveText: HOUSING_OBJECTIVE,
    });
    assert.ok(ws.project.id);
    assert.equal((await services.listProjects()).length, 1);
  });

  it("recordProjectOpen on a missing project is a no-op and does not break create", async () => {
    await services.recordProjectOpen("stale-browser-project-id");
    const ws = await services.createProject({
      name: "After stale open",
      objectiveText: HOUSING_OBJECTIVE,
    });
    assert.ok(ws.project.id);
  });
});

describe("transit threshold normalization", () => {
  it("clamps unrealistic UI values", async () => {
    const { normalizeTransitThresholdMeters } = await import("./transit-threshold");
    const extreme = normalizeTransitThresholdMeters(4000);
    assert.equal(extreme.meters, 2000);
    assert.match(extreme.warning ?? "", /bike-access/i);
    const walk = normalizeTransitThresholdMeters(1500);
    assert.equal(walk.meters, 1500);
    assert.match(walk.warning ?? "", /walk distance/i);
  });
});
