import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resetStore, updateStore } from "./store";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import {
  detectIntent,
  parseObjective,
  normalizeWeights,
  serviceTypesInObjective,
} from "./objective";
import { runSpatialAnalysis } from "./spatial";
import { generateSyntheticCity } from "./seed";
import { getPageToolBudgetMs } from "@/lib/webmcp/page-tool-budget";

const INfill_OBJECTIVE =
  "Find infill housing sites in San Francisco that sit within a 10-minute walk of frequent transit, stay out of FEMA flood zones, and can deliver at least 50 units without displacing existing parks or schools.";

describe("pass-48 objective parsing", () => {
  it("probe infill objective parses as housing_capacity not service_access", () => {
    assert.equal(detectIntent(INfill_OBJECTIVE), "housing_capacity");
    const parsed = parseObjective(INfill_OBJECTIVE);
    assert.equal(parsed.objective.intent, "housing_capacity");
    assert.equal(parsed.objective.targetValue, 50);
    assert.ok(parsed.constraints.some((c) => /transit/i.test(c.label)));
    assert.ok(parsed.constraints.some((c) => /flood/i.test(c.label)));
  });

  it("parks and schools in exclusion context are not service-access targets", () => {
    assert.deepEqual(serviceTypesInObjective(INfill_OBJECTIVE), []);
    const access = parseObjective(
      "Identify neighborhoods underserved by parks and schools. This is not a housing production question."
    );
    assert.equal(access.objective.intent, "service_access");
    assert.ok(access.objective.serviceTypes?.includes("school"));
    assert.ok(access.objective.serviceTypes?.includes("park"));
  });

  it("10-minute walk transit constraint is parsed from rawText", () => {
    const parsed = parseObjective(INfill_OBJECTIVE);
    const transit = parsed.constraints.find((c) => c.datasetKind === "transit");
    assert.ok(transit);
    assert.equal(transit?.value, 800);
  });
});

describe("pass-48 reconcile and scoring", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-pass48-${Date.now()}-${Math.random()}`;
    process.env.UPC_ANALYSIS_SYNC = "1";
    services.setAnalysisDelayForTests(0);
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.UPC_ANALYSIS_SYNC;
    delete process.env.UPC_PAGE_TOOL_BUDGET_MS;
    services.setAnalysisDelayForTests(0);
  });

  it("run_analysis re-parses stale service_access intent from stored rawText", async () => {
    const ws = await services.createProject({
      name: "Pass 48 reconcile",
      objectiveText: INfill_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await updateStore((store) => {
      const scenario = store.scenarios.find((s) => s.id === scenarioId)!;
      scenario.objective = {
        ...scenario.objective,
        intent: "service_access",
      };
    });

    await services.runAnalysis(ws.project.id, scenarioId);
    const after = await services.getWorkspace(ws.project.id);
    const scenario = after!.scenarios.find((s) => s.id === scenarioId)!;
    assert.equal(scenario.objective.intent, "housing_capacity");

    const result = after!.analysisResults.find((r) => r.id === scenario.latestResultId);
    assert.ok(result);
    assert.ok(result!.candidates.length > 1);
    const scores = result!.candidates.map((c) => c.score);
    const unique = new Set(scores);
    assert.ok(unique.size > 1, `expected score spread, got ${[...unique].join(", ")}`);
    assert.ok(!scores.every((score) => score === 50));
    assert.match(result!.summary ?? "", /eligible|homes|candidates/i);
    assert.doesNotMatch(result!.summary ?? "", /service-access gaps/i);
  });

  it("housing analysis differentiates scores when school layers are missing", () => {
    const city = generateSyntheticCity(9);
    const parsed = parseObjective(INfill_OBJECTIVE);
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) {
      if (d.kind === "schools" || d.kind === "population" || d.kind === "parks") continue;
      layers[d.kind] = city.featuresByDataset[d.id];
    }
    const out = runSpatialAnalysis({
      objective: parsed.objective,
      constraints: parsed.constraints,
      weights: normalizeWeights(parsed.weights),
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds: Object.fromEntries(
        city.datasets.filter((d) => layers[d.kind]).map((d) => [d.kind, d.id])
      ),
      externalLimitations: ["Schools dataset unavailable — school access metrics cannot be computed"],
    });
    const scores = out.candidates.map((c) => c.score);
    assert.ok(new Set(scores).size > 1);
  });
});

describe("pass-48 MCP tools", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-pass48-mcp-${Date.now()}-${Math.random()}`;
    process.env.UPC_ANALYSIS_SYNC = "1";
    services.setAnalysisDelayForTests(0);
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.UPC_ANALYSIS_SYNC;
    delete process.env.UPC_PAGE_TOOL_BUDGET_MS;
    services.setAnalysisDelayForTests(0);
  });

  it("list_candidates returns a small ranked page with totalCount", async () => {
    const ws = await services.createProject({
      name: "Pass 48 list",
      objectiveText: INfill_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await invokeTool("run_analysis", { projectId: ws.project.id, scenarioId });

    const started = Date.now();
    const listed = await invokeTool("list_candidates", {
      projectId: ws.project.id,
      scenarioId,
      limit: 5,
    });
    assert.equal(listed.ok, true);
    assert.ok(Date.now() - started < 3000);
    if (listed.ok) {
      const payload = listed.result as {
        candidates?: unknown[];
        totalCount?: number;
        scoreSpread?: number;
      };
      assert.ok((payload.totalCount ?? 0) > (payload.candidates?.length ?? 0));
      assert.equal(payload.candidates?.length, 5);
      assert.ok((payload.scoreSpread ?? 0) > 0);
    }
  });

  it("run_analysis returns ANALYSIS_IN_PROGRESS when job exceeds page-tool budget", async () => {
    process.env.UPC_ANALYSIS_SYNC = "0";
    process.env.UPC_PAGE_TOOL_BUDGET_MS = "100";
    services.setAnalysisDelayForTests(400);

    const ws = await services.createProject({
      name: "Pass 48 in-progress",
      objectiveText: INfill_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;

    const started = Date.now();
    const run = await invokeTool("run_analysis", {
      projectId: ws.project.id,
      scenarioId,
    });
    assert.ok(Date.now() - started < getPageToolBudgetMs() + 900);
    assert.equal(run.ok, false);
    if (!run.ok) {
      assert.equal(run.error.code, "ANALYSIS_IN_PROGRESS");
    }

    await new Promise((resolve) => setTimeout(resolve, 600));
    const status = await services.getAnalysisRunStatus(ws.project.id, scenarioId);
    assert.equal(status.status, "completed");
    assert.ok((status.candidateCount ?? 0) > 0);
  });
});
