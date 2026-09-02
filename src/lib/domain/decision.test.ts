import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import path from "path";
import {
  validateDecisionReason,
  canRecordScenarioDecision,
  getLatestCompletedResult,
  getLatestFreshResult,
  topRankedCandidate,
  MIN_DECISION_REASON_LENGTH,
} from "./decision";
import type { AnalysisResult, Scenario } from "./types";
import { resetStore } from "./store";
import * as services from "./services";
import { promises as fs } from "fs";

function baseScenario(overrides: Partial<Scenario> = {}): Scenario {
  return {
    id: "sc-1",
    projectId: "proj-1",
    name: "Baseline",
    status: "draft",
    objective: {
      rawText: "Find 2000 homes near transit",
      intent: "housing_capacity",
      targetValue: 2000,
      targetUnit: "homes",
      geographyLabel: "Study area",
      parsedRequirements: [],
      confidence: 0.9,
    },
    constraints: [],
    weights: [],
    assumptions: [],
    geographicSelections: [],
    enabledDatasetIds: [],
    decisionStatus: "none",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    annotations: [],
    ...overrides,
  };
}

function completedResult(scenarioId: string, stale = false): AnalysisResult {
  return {
    id: "res-1",
    jobId: "job-1",
    scenarioId,
    status: stale ? "stale" : "completed",
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    candidates: [
      {
        id: "parcel-1",
        label: "Block 7-8",
        featureIds: ["parcel-1"],
        geometry: { type: "Point", coordinates: [0, 0] },
        centroid: [0, 0],
        score: 97.9,
        rank: 1,
        metrics: [],
        provenance: {
          scoreBreakdown: {},
          calculations: [],
          datasets: [],
          assumptions: [],
          constraints: [],
          humanDecisions: [],
          limitations: [],
        },
        status: "eligible",
      },
      {
        id: "parcel-2",
        label: "Block 6-5",
        featureIds: ["parcel-2"],
        geometry: { type: "Point", coordinates: [0, 0] },
        centroid: [0, 0],
        score: 90,
        rank: 3,
        metrics: [],
        provenance: {
          scoreBreakdown: {},
          calculations: [],
          datasets: [],
          assumptions: [],
          constraints: [],
          humanDecisions: [],
          limitations: [],
        },
        status: "eligible",
      },
    ],
    aggregateMetrics: [],
    summary: "2 candidates",
    limitations: [],
    stale,
    configHash: "abc",
  };
}

describe("decision validation", () => {
  it("rejects short and junk reasons", () => {
    assert.equal(validateDecisionReason("ok"), `Reason must be at least ${MIN_DECISION_REASON_LENGTH} characters.`);
    assert.equal(
      validateDecisionReason("   "),
      "Please enter a reason — required for the audit trail."
    );
    assert.equal(
      validateDecisionReason("ok ok ok ok"),
      "Please provide a substantive justification (not placeholders like \"ok\")."
    );
    assert.equal(validateDecisionReason(null), "Please enter a reason — required for the audit trail.");
    assert.equal(
      validateDecisionReason("Baseline preferred for flood resilience and existing infrastructure."),
      null
    );
  });

  it("cannot approve without completed analysis", () => {
    const scenario = baseScenario({ latestResultId: undefined });
    const err = canRecordScenarioDecision(scenario, [], "approve_scenario", "Valid reason here");
    assert.match(err!, /Run analysis/);
  });

  it("cannot approve on stale results", () => {
    const scenario = baseScenario({ latestResultId: "res-1" });
    const results = [completedResult("sc-1", true)];
    const err = canRecordScenarioDecision(
      scenario,
      results,
      "approve_scenario",
      "Valid reason with enough length"
    );
    assert.match(err!, /stale/i);
  });

  it("top ranked candidate is rank 1 not selection order", () => {
    const result = completedResult("sc-1");
    const top = topRankedCandidate(result);
    assert.equal(top?.label, "Block 7-8");
    assert.equal(top?.rank, 1);
  });
});

describe("decision persistence integration", () => {
  const testDataDir = path.join(process.cwd(), "data-test-decision");
  const originalDataDir = process.env.DATA_DIR;

  beforeEach(async () => {
    process.env.DATA_DIR = testDataDir;
    await fs.rm(testDataDir, { recursive: true, force: true });
    await resetStore();
  });

  afterEach(async () => {
    process.env.DATA_DIR = originalDataDir;
    await fs.rm(testDataDir, { recursive: true, force: true });
  });

  it("invalidates approval after weight change", async () => {
    const ws = await services.createProject({
      name: "Test Housing",
      objectiveText:
        "Find suitable areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones, while respecting residential zoning.",
    });
    const scenario = ws.scenarios[0];
    await services.runAnalysis(ws.project.id, scenario.id);
    await services.recordDecision({
      projectId: ws.project.id,
      scenarioId: scenario.id,
      type: "approve_scenario",
      reason: "Baseline aligns with council priorities and lower flood exposure.",
    });

    const fresh = await services.getWorkspace(ws.project.id);
    const sc = fresh!.scenarios[0];
    assert.equal(sc.decisionStatus, "approved");

    const weights = sc.weights.map((w) =>
      w.key === "capacity" ? { ...w, weight: 0.9 } : { ...w, weight: 0.05 }
    );
    await services.updateWeights(ws.project.id, scenario.id, weights);

    const after = await services.getWorkspace(ws.project.id);
    const updated = after!.scenarios[0];
    assert.equal(updated.decisionStale, true);
    assert.notEqual(updated.decisionStatus, "approved");
  });

  it("rejects approve without analysis via API layer", async () => {
    const ws = await services.createProject({
      name: "No Analysis",
      objectiveText:
        "Find suitable areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones.",
    });
    const scenario = ws.scenarios[0];
    await assert.rejects(
      () =>
        services.recordDecision({
          projectId: ws.project.id,
          scenarioId: scenario.id,
          type: "approve_scenario",
          reason: "Trying to approve without running analysis first.",
        }),
      /Run analysis/
    );
  });

  it("allows report generation after recalculate clears stale lock", async () => {
    const ws = await services.createProject({
      name: "Report Recalc",
      objectiveText:
        "Find suitable areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones, while respecting residential zoning.",
    });
    const scenario = ws.scenarios[0];
    await services.runAnalysis(ws.project.id, scenario.id);

    const weights = scenario.weights.map((w) =>
      w.key === "transit" ? { ...w, weight: 0.7 } : { ...w, weight: 0.15 }
    );
    await services.updateWeights(ws.project.id, scenario.id, weights);
    await services.runAnalysis(ws.project.id, scenario.id);

    const report = await services.generateReport(ws.project.id, [scenario.id]);
    assert.ok(report.reportId);
    assert.ok(report.report?.sections.length);
  });

  it("keeps multiple report versions", async () => {
    const ws = await services.createProject({
      name: "Report History",
      objectiveText:
        "Find suitable areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones, while respecting residential zoning.",
    });
    const scenario = ws.scenarios[0];
    await services.runAnalysis(ws.project.id, scenario.id);
    await services.generateReport(ws.project.id, [scenario.id], "Report v1");
    await services.generateReport(ws.project.id, [scenario.id], "Report v2");
    const after = await services.getWorkspace(ws.project.id);
    assert.ok(after!.reports.length >= 2);
    assert.equal(after!.reports[0].title, "Report v2");
    assert.equal(after!.reports[1].title, "Report v1");
  });
});

describe("getLatestCompletedResult", () => {
  it("returns stale results for inspection but fresh helper filters them", () => {
    const scenario = baseScenario({ latestResultId: "res-1" });
    assert.ok(getLatestCompletedResult(scenario, [completedResult("sc-1", true)]));
    assert.equal(getLatestFreshResult(scenario, [completedResult("sc-1", true)]), undefined);
    assert.ok(getLatestFreshResult(scenario, [completedResult("sc-1", false)]));
  });
});
