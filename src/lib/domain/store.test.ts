import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import {
  clearStoreCache,
  getStorePath,
  getStore,
  getLastBootRecovery,
  reloadStoreFromDisk,
  resetStore,
  resetDataDirCacheForTests,
  updateStore,
  setPersistFailureInjector,
  StorePersistError,
  verifyWritableDataDir,
  refreshStorageHealthProbe,
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

  it("flood-weighted branch shifts persisted weights toward flood resilience", async () => {
    const ws = await services.createProject({
      name: "Flood branch weights",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    const baseline = ws.scenarios.find((s) => s.id === baselineId)!;
    const baselineFlood = Math.round(
      (baseline.weights.find((w) => w.key.includes("flood"))?.weight ?? 0) * 100
    );

    const branched = await services.createScenario(
      ws.project.id,
      "Flood-weighted branch",
      baselineId
    );
    const branch = branched.scenarios.find((s) => s.name === "Flood-weighted branch")!;
    const branchFlood = Math.round(
      (branch.weights.find((w) => w.key.includes("flood"))?.weight ?? 0) * 100
    );

    assert.equal(branchFlood, 35);
    assert.ok(branchFlood > baselineFlood);
    assert.match(branched.project.resumeNote ?? "", /still viewing/i);
    assert.equal(branched.project.activeScenarioId, baselineId);
  });

  it("branch create keeps analyzed scenario active", async () => {
    const ws = await services.createProject({
      name: "Stay on analyzed branch",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);

    const branched = await services.createScenario(ws.project.id, "Flood-weighted branch", baselineId);
    assert.equal(branched.project.activeScenarioId, baselineId);
    const branch = branched.scenarios.find((s) => s.name === "Flood-weighted branch")!;
    assert.ok(branch);
    assert.equal(branch.latestResultId, undefined);
  });

  it("scenario branch does not inherit parent decision or resume note", async () => {
    const ws = await services.createProject({
      name: "Branch decision reset",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);
    await services.recordDecision({
      projectId: ws.project.id,
      scenarioId: baselineId,
      reason: "Meets housing target with acceptable flood risk.",
      type: "approve_scenario",
    });
    const approved = await services.getWorkspace(ws.project.id);
    assert.match(approved!.project.resumeNote ?? "", /Decision recorded/);

    const branched = await services.createScenario(ws.project.id, "Branch without analysis");
    const branch = branched.scenarios.find((s) => s.name === "Branch without analysis")!;
    assert.equal(branch.decisionStatus, "none");
    assert.equal(branch.latestResultId, undefined);
    assert.match(branched.project.resumeNote ?? "", /still viewing/i);
    assert.doesNotMatch(branched.project.resumeNote ?? "", /Decision recorded/);
  });

  it("refreshStorageHealthProbe marks degraded when directory is not writable", async () => {
    const readOnly = path.join(tmpDir, "readonly");
    await fs.mkdir(readOnly, { recursive: true });
    await fs.chmod(readOnly, 0o555);
    process.env.DATA_DIR = readOnly;
    resetDataDirCacheForTests();
    clearStoreCache();
    try {
      const health = await refreshStorageHealthProbe();
      assert.equal(health.status, "degraded");
      assert.equal(health.writeProbeOk, false);
    } finally {
      await fs.chmod(readOnly, 0o755).catch(() => undefined);
    }
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

  it("persists compact analysis results without candidate geometries on disk", async () => {
    const ws = await services.createProject({
      name: "Compact persist",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    const raw = await fs.readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(raw) as {
      analysisResults: Array<{ candidates: Array<{ geometry?: unknown }> }>;
    };
    for (const result of parsed.analysisResults) {
      for (const c of result.candidates) {
        assert.equal(c.geometry, undefined, "candidates on disk must not embed geometry");
      }
    }
    const reloaded = await reloadStoreFromDisk();
    const result = reloaded.analysisResults.find(
      (r) => r.id === reloaded.scenarios[0]?.latestResultId
    );
    assert.ok(result);
    assert.ok(result!.candidates.length > 0);
    assert.ok(result!.candidates[0]?.geometry);
  });

  it("keeps one project and both scenario results after two analyses and reload", async () => {
    const ws = await services.createProject({
      name: "Two scenario analysis",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);
    const branched = await services.createScenario(ws.project.id, "Branch B", baselineId);
    const branchId = branched.scenarios.find((s) => s.name === "Branch B")!.id;
    await services.runAnalysis(ws.project.id, branchId);

    const reloaded = await reloadStoreFromDisk();
    assert.equal(reloaded.projects.length, 1);
    assert.equal(reloaded.scenarios.length, 2);

    const baselineResult = reloaded.analysisResults.find(
      (r) => r.id === reloaded.scenarios.find((s) => s.id === baselineId)?.latestResultId
    );
    const branchResult = reloaded.analysisResults.find(
      (r) => r.id === reloaded.scenarios.find((s) => s.id === branchId)?.latestResultId
    );
    assert.ok(baselineResult?.candidates.length);
    assert.ok(branchResult?.candidates.length);
  });

  it("does not drop projects when persist fails mid-write", async () => {
    const ws = await services.createProject({
      name: "Persist failure guard",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);

    setPersistFailureInjector(() => {
      throw new StorePersistError("Injected persist failure");
    });
    try {
      await assert.rejects(
        () =>
          updateStore((store) => {
            store.projects[0]!.resumeNote = "should not stick";
          }),
        /Injected persist failure/
      );
      const after = await getStore();
      assert.equal(after.projects.length, 1);
      assert.equal(after.projects[0]?.name, "Persist failure guard");
      assert.notEqual(after.projects[0]?.resumeNote, "should not stick");
    } finally {
      setPersistFailureInjector(null);
    }
  });

  it("setActiveScenario is a no-op when scenario is already active", async () => {
    const ws = await services.createProject({
      name: "Active scenario no-op",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);
    await services.recordDecision({
      projectId: ws.project.id,
      scenarioId: baselineId,
      reason: "Meets housing target with acceptable flood risk.",
      type: "approve_scenario",
    });
    const before = await services.getWorkspace(ws.project.id);
    assert.match(before!.project.resumeNote ?? "", /Decision recorded/);

    const after = await services.setActiveScenario(ws.project.id, baselineId);
    assert.equal(after!.project.activeScenarioId, baselineId);
    assert.match(after!.project.resumeNote ?? "", /Decision recorded/);
    const activities = after!.activities.filter((a) => a.action === "activate_scenario");
    assert.equal(activities.length, 0);
  });

  it("repairs missing activeScenarioId on getWorkspace", async () => {
    const ws = await services.createProject({
      name: "Scenario repair",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await updateStore((store) => {
      const project = store.projects.find((p) => p.id === ws.project.id);
      if (project) project.activeScenarioId = "orphaned-scenario-id";
    });
    const repaired = await services.getWorkspace(ws.project.id);
    assert.ok(repaired);
    assert.equal(repaired!.project.activeScenarioId, baselineId);
    assert.ok(repaired!.scenarios.some((s) => s.id === baselineId));
  });

  it("resolves stale scenario id for geographic exclusion add", async () => {
    const ws = await services.createProject({
      name: "Geo stale id",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.addGeographicSelection(ws.project.id, "stale-id", {
      type: "exclusion",
      label: "QA exclusion polygon",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-122.42, 37.76],
            [-122.41, 37.76],
            [-122.41, 37.77],
            [-122.42, 37.77],
            [-122.42, 37.76],
          ],
        ],
      },
      createdBy: "human",
    });
    const after = await services.getWorkspace(ws.project.id);
    const scenario = after!.scenarios.find((s) => s.id === scenarioId);
    assert.equal(scenario?.geographicSelections.length, 1);
    assert.equal(scenario?.geographicSelections[0]?.label, "QA exclusion polygon");
  });

  it("concurrent verifyWritableDataDir calls do not throw ENOENT", async () => {
    const probeDir = path.join(tmpDir, "probe-race");
    await Promise.all([
      verifyWritableDataDir(probeDir),
      verifyWritableDataDir(probeDir),
      verifyWritableDataDir(probeDir),
      verifyWritableDataDir(probeDir),
      verifyWritableDataDir(probeDir),
    ]);
  });

  it("updateStore still works when a shared write-probe file is already gone", async () => {
    const ws = await services.createProject({
      name: "Probe race survivor",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const legacyProbe = path.join(tmpDir, ".write-probe");
    await fs.writeFile(legacyProbe, "stale", "utf8");
    await fs.unlink(legacyProbe);
    await updateStore((store) => {
      const project = store.projects.find((p) => p.id === ws.project.id);
      if (project) project.resumeNote = "probe unlink race ok";
    });
    const reloaded = await reloadStoreFromDisk();
    assert.equal(
      reloaded.projects.find((p) => p.id === ws.project.id)?.resumeNote,
      "probe unlink race ok"
    );
  });

  it("refuses to load store when normalization would drop projects", async () => {
    await services.createProject({
      name: "Must survive parse",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const storePath = getStorePath();
    const backupPath = `${storePath}.bak`;
    const corrupt = async () => {
      const raw = await fs.readFile(storePath, "utf8");
      const legacy = JSON.parse(raw) as Record<string, unknown>;
      legacy.projects = "corrupt-not-array";
      const payload = JSON.stringify(legacy);
      await fs.writeFile(storePath, payload, "utf8");
      await fs.writeFile(backupPath, payload, "utf8");
    };
    await corrupt();
    await assert.rejects(() => reloadStoreFromDisk(), /projects field is not an array/);
  });

  it("refuses to persist empty catalog over non-empty disk store", async () => {
    await services.createProject({
      name: "Must not be wiped",
      objectiveText: HOUSING_OBJECTIVE,
    });
    let caught: unknown;
    try {
      await updateStore((store) => {
        store.projects = [];
        store.scenarios = [];
      });
    } catch (err) {
      caught = err;
    }
    assert.ok(caught instanceof StorePersistError);
    assert.match((caught as Error).message, /Refusing to persist empty catalog/);
    const reloaded = await reloadStoreFromDisk();
    assert.equal(reloaded.projects.length, 1);
    assert.equal(reloaded.projects[0]?.name, "Must not be wiped");
  });

  it("does not write empty catalog on persistent mount when store files are missing", async () => {
    const previousRetry = process.env.STORE_DISK_READ_RETRY_MS;
    const previousPrefix = process.env.RENDER_DATA_DIR_PREFIX;
    process.env.STORE_DISK_READ_RETRY_MS = "0";
    const renderRoot = path.join(tmpDir, "render-disk");
    process.env.RENDER_DATA_DIR_PREFIX = renderRoot;
    const persistentDir = path.join(renderRoot, `upc-test-${Date.now()}`);
    await fs.mkdir(persistentDir, { recursive: true });
    process.env.DATA_DIR = persistentDir;
    clearStoreCache();
    resetDataDirCacheForTests();
    try {
      const store = await reloadStoreFromDisk();
      assert.equal(store.projects.length, 0);
      assert.equal(getLastBootRecovery(), "empty-after-missing-file");
      assert.equal(
        await fs
          .access(path.join(persistentDir, "store.json"))
          .then(() => true)
          .catch(() => false),
        false
      );
    } finally {
      process.env.STORE_DISK_READ_RETRY_MS = previousRetry;
      process.env.RENDER_DATA_DIR_PREFIX = previousPrefix;
    }
  });

  it("upgrades store missing newer fields without clearing projects", async () => {
    const ws = await services.createProject({
      name: "Legacy shape",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const storePath = getStorePath();
    const raw = await fs.readFile(storePath, "utf8");
    const legacy = JSON.parse(raw) as Record<string, unknown>;
    delete legacy.proposals;
    delete legacy.confirmations;
    await fs.writeFile(storePath, JSON.stringify(legacy), "utf8");
    const reloaded = await reloadStoreFromDisk();
    assert.equal(reloaded.projects.length, 1);
    assert.equal(reloaded.projects[0]?.id, ws.project.id);
    assert.ok(Array.isArray(reloaded.proposals));
    assert.ok(Array.isArray(reloaded.confirmations));
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
