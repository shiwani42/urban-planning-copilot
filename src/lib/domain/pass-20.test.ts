import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import { reloadStoreFromDisk, resetStore } from "./store";

const HOUSING_OBJECTIVE =
  "Find suitable areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones, while respecting residential zoning.";

describe("pass-20 hardening", () => {
  let tmpDir: string;
  let previousDataDir: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass20-"));
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

  it("listProjects shows approval and active branch without action-required review", async () => {
    const ws = await services.createProject({
      name: "Multi branch",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);
    await services.recordDecision({
      projectId: ws.project.id,
      scenarioId: baselineId,
      type: "approve_scenario",
      reason: "Baseline meets housing and transit goals for council review.",
    });

    const branched = await services.createScenario(ws.project.id, "Branch B", baselineId);
    const branchId = branched.scenarios.find((s) => s.name === "Branch B")!.id;
    await services.setActiveScenario(ws.project.id, branchId);
    await services.runAnalysis(ws.project.id, branchId);

    const listed = await services.listProjects();
    const item = listed.find((p) => p.id === ws.project.id);
    assert.ok(item);
    assert.equal(item.approvedScenarioName, "Baseline");
    assert.match(item.activeScenarioNote ?? "", /candidates/);
    assert.equal(item.actionRequiredLabel, undefined);
  });

  it("marks existing reports stale after a planner decision", async () => {
    const ws = await services.createProject({
      name: "Report stale",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, scenarioId);
    const generated = await services.generateReport(ws.project.id, [scenarioId]);
    assert.ok(generated.report);
    assert.equal(generated.report?.stale, undefined);

    await services.recordDecision({
      projectId: ws.project.id,
      scenarioId,
      type: "approve_scenario",
      reason: "Top candidate aligns with transit-first policy goals.",
    });

    const after = await services.getWorkspace(ws.project.id);
    const report = after!.reports.find((r) => r.id === generated.reportId);
    assert.equal(report?.stale, true);
    assert.match(report?.staleReason ?? "", /Planner decision recorded/);

    const refreshed = await services.generateReport(ws.project.id, [scenarioId], "After decision");
    const decisionSection = refreshed.report?.sections.find((s) =>
      s.heading.includes("Planner decision")
    );
    assert.match(decisionSection?.body ?? "", /Status: Approved/);
  });

  it("report datasets section lists plan-used datasets with unused note", async () => {
    const ws = await services.createProject({
      name: "Report datasets",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, scenarioId);
    const { report } = await services.generateReport(ws.project.id, [scenarioId]);
    const section = report?.sections.find((s) => s.heading.startsWith("Datasets"));
    assert.ok(section);
    assert.match(section.body, /parcel/i);
    const store = await reloadStoreFromDisk();
    const scenario = store.scenarios.find((s) => s.id === scenarioId)!;
    const usedIds = new Set<string>();
    for (const step of scenario.analysisPlan?.steps ?? []) {
      for (const ref of step.datasets) {
        const byName = store.datasets.find((d) => d.name.toLowerCase() === ref.toLowerCase());
        const byKind = store.datasets.find((d) => d.kind === ref);
        if (byName) usedIds.add(byName.id);
        if (byKind) usedIds.add(byKind.id);
      }
    }
    const unusedEnabled = store.datasets.filter(
      (d) => d.enabled && scenario.enabledDatasetIds.includes(d.id) && !usedIds.has(d.id)
    );
    if (unusedEnabled.length) {
      assert.match(section.body, /not used by this scenario's analysis plan/i);
      for (const d of unusedEnabled) {
        assert.match(section.body, new RegExp(d.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
      }
    }
  });

  it("markDatasetStale only invalidates scenarios that use the dataset in their plan", async () => {
    const ws = await services.createProject({
      name: "Scoped stale",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);

    const branched = await services.createScenario(ws.project.id, "No flood", baselineId);
    const branch = branched.scenarios.find((s) => s.name === "No flood")!;
    await services.updateConstraints(ws.project.id, branch.id, [
      ...branch.constraints.map((c) =>
        c.datasetKind === "flood" ? { ...c, enabled: false } : c
      ),
    ]);
    await services.runAnalysis(ws.project.id, branch.id);

    const store = await reloadStoreFromDisk();
    const floodId = store.datasets.find((d) => d.kind === "flood")!.id;
    await services.markDatasetStale(floodId, true);

    const after = await reloadStoreFromDisk();
    const baselineResult = after.analysisResults.find(
      (r) => r.id === after.scenarios.find((s) => s.id === baselineId)?.latestResultId
    );
    const branchResult = after.analysisResults.find(
      (r) => r.id === after.scenarios.find((s) => s.id === branch.id)?.latestResultId
    );
    assert.equal(baselineResult?.stale, true);
    assert.equal(branchResult?.stale, false);
  });

  it("clearing dataset outdated flag does not restore fresh results", async () => {
    const ws = await services.createProject({
      name: "Clear stale flag",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, scenarioId);

    const store = await reloadStoreFromDisk();
    const floodId = store.datasets.find((d) => d.kind === "flood")!.id;
    await services.markDatasetStale(floodId, true);
    await services.markDatasetStale(floodId, false);

    const after = await reloadStoreFromDisk();
    const ds = after.datasets.find((d) => d.id === floodId);
    assert.equal(ds?.stale, false);
    const result = after.analysisResults.find(
      (r) => r.id === after.scenarios.find((s) => s.id === scenarioId)?.latestResultId
    );
    assert.equal(result?.stale, true, "results stay stale until recalculate");
  });
});
