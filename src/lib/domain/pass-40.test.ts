import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import * as services from "./services";
import { resetStore } from "./store";
import { executePlanningTool } from "@/lib/webmcp/server-handlers";

describe("pass 40 copilot exclusion and scenario context", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass40-"));
    process.env.DATA_DIR = tmpDir;
    await resetStore();
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("exclude_features MCP tool excludes selected parcel features", async () => {
    const ws = await services.createProject({
      name: "Exclude features MCP",
      objectiveText:
        "Identify areas capable of accommodating 500 additional homes near transit.",
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, scenarioId);
    const afterAnalysis = await services.getWorkspace(ws.project.id);
    const scenario = afterAnalysis!.scenarios.find((s) => s.id === scenarioId)!;
    const result = afterAnalysis!.analysisResults.find((r) => r.id === scenario.latestResultId)!;
    const candidate = result.candidates[0]!;

    const toolResult = await executePlanningTool(
      "exclude_features",
      {
        projectId: ws.project.id,
        scenarioId,
        featureIds: candidate.featureIds,
        label: `Exclude ${candidate.label}`,
      },
      { projectId: ws.project.id, scenarioId }
    );
    assert.match(String((toolResult as { excluded?: string }).excluded ?? ""), /Exclude/);

    const refreshed = await services.getWorkspace(ws.project.id);
    const live = refreshed!.scenarios.find((s) => s.id === scenarioId)!;
    assert.ok(
      live.constraints.some(
        (c) => c.operator === "excluded_ids" && c.value.includes(candidate.featureIds[0]!)
      )
    );
  });

  it("stale scenarioId in MCP context falls back to active scenario", async () => {
    const ws = await services.createProject({
      name: "Stale scenario fallback",
      objectiveText:
        "Identify areas capable of accommodating 500 additional homes near transit.",
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);
    const branched = await services.createScenario(ws.project.id, "Flood-weighted branch");
    const branchId = branched.project.activeScenarioId!;

    const toolResult = await executePlanningTool(
      "exclude_map_area",
      {
        projectId: ws.project.id,
        scenarioId: "orphan-scenario",
        label: "Copilot exclusion",
        coordinates: [
          [-122.42, 37.76],
          [-122.41, 37.76],
          [-122.41, 37.77],
        ],
      },
      { projectId: ws.project.id, scenarioId: "orphan-scenario" }
    );
    assert.equal((toolResult as { excluded?: string }).excluded, "Copilot exclusion");

    const after = await services.getWorkspace(ws.project.id);
    assert.equal(after!.project.activeScenarioId, branchId);
    const branch = after!.scenarios.find((s) => s.id === branchId)!;
    assert.equal(branch.geographicSelections.length, 1);
    assert.notEqual(baselineId, branchId);
  });

  it("setActiveScenario switches scenario for home deep links", async () => {
    await resetStore();
    const ws = await services.createProject({
      name: "Deep link scenario",
      objectiveText:
        "Identify areas capable of accommodating 500 additional homes near transit.",
    });
    const baselineId = ws.project.activeScenarioId!;
    const branched = await services.createScenario(ws.project.id, "Branch B");
    const branchId = branched.project.activeScenarioId!;
    await services.setActiveScenario(ws.project.id, baselineId);
    const switched = await services.getWorkspace(ws.project.id);
    assert.equal(switched!.project.activeScenarioId, baselineId);
    assert.notEqual(branchId, baselineId);
  });
});
