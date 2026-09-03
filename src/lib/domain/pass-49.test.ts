import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import * as turf from "@turf/turf";
import { resetStore, updateStore, getStorePath } from "./store";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import { parseObjective, normalizeWeights } from "./objective";
import { runSpatialAnalysis } from "./spatial";
import { generateSyntheticCity } from "./seed";
import { getPageToolBudgetMs } from "@/lib/webmcp/page-tool-budget";
import { reconcileInterruptedAnalysisJobsOnBoot } from "./analysis-jobs";
import { isCompactCandidate } from "./analysis-candidates";
import { STUDY_BOUNDS } from "./study-bounds";

const HOUSING_OBJECTIVE =
  "Find infill housing sites in San Francisco that sit within a 10-minute walk of frequent transit, stay out of FEMA flood zones, and can deliver at least 50 units without displacing existing parks or schools.";

function generateParcelGrid(count: number): GeoJSON.FeatureCollection {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const { west, south, east, north } = STUDY_BOUNDS;
  const dx = (east - west) / cols;
  const dy = (north - south) / rows;
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < count; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    const w = west + c * dx;
    const s = south + r * dy;
    const poly = turf.bboxPolygon([w, s, w + dx * 0.9, s + dy * 0.9]);
    poly.properties = {
      id: `bulk-parcel-${i}`,
      zoning: "R3",
      land_use: "residential",
      area_sqm: 1200 + (i % 17) * 40,
      density_uph: 50 + (i % 11) * 5,
      existing_units: i % 8,
    };
    poly.id = `bulk-parcel-${i}`;
    features.push(poly);
  }
  return { type: "FeatureCollection", features };
}

describe("pass-49 compact analysis memory", () => {
  it("housing analysis of ~1.5k parcels uses compact candidates without polygon geometry", () => {
    const city = generateSyntheticCity(11);
    const parcels = generateParcelGrid(1500);
    const parsed = parseObjective(HOUSING_OBJECTIVE);
    const layers: Record<string, GeoJSON.FeatureCollection> = {
      parcels,
      transit: city.featuresByDataset[city.datasets.find((d) => d.kind === "transit")!.id],
      flood: city.featuresByDataset[city.datasets.find((d) => d.kind === "flood")!.id],
    };
    const out = runSpatialAnalysis({
      objective: parsed.objective,
      constraints: parsed.constraints,
      weights: normalizeWeights(parsed.weights),
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds: Object.fromEntries(
        city.datasets
          .filter((d) => layers[d.kind])
          .map((d) => [d.kind, d.id])
      ),
      externalLimitations: [],
    });
    assert.ok(out.candidates.length > 100);
    assert.ok(out.candidates.every((c) => isCompactCandidate(c)));
    assert.ok(out.candidates.every((c) => c.geometry.type === "Point"));
    const scores = out.candidates.map((c) => c.score);
    assert.ok(new Set(scores).size > 1);
    assert.ok(!out.summary.match(/service-access gaps/i));
  });
});

describe("pass-49 failed job surfacing", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-pass49-${Date.now()}-${Math.random()}`;
    process.env.UPC_ANALYSIS_SYNC = "1";
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.UPC_ANALYSIS_SYNC;
  });

  it("reconcileInterruptedAnalysisJobsOnBoot marks running jobs failed", async () => {
    const ws = await services.createProject({
      name: "Pass 49 interrupted",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await updateStore((store) => {
      store.analysisJobs.push({
        id: "stale-running-job",
        scenarioId,
        status: "running",
        planId: "none",
        startedAt: new Date().toISOString(),
        progress: 40,
        currentStep: "Scoring parcels",
        activityIds: [],
        configHash: "abc",
      });
    });
    const store = await import("./store").then((m) => m.getStore());
    assert.equal(reconcileInterruptedAnalysisJobsOnBoot(store), true);
    const job = store.analysisJobs.find((j) => j.id === "stale-running-job");
    assert.equal(job?.status, "failed");
    assert.match(job?.error ?? "", /interrupted/i);
  });

  it("list_candidates returns error status when latest analysis failed", async () => {
    const ws = await services.createProject({
      name: "Pass 49 list error",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await updateStore((store) => {
      store.analysisJobs.push({
        id: "failed-job",
        scenarioId,
        status: "failed",
        planId: "none",
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        progress: 0,
        currentStep: "Failed",
        activityIds: [],
        configHash: "abc",
        error: "JavaScript heap out of memory",
      });
    });
    const page = await services.listCandidatesPage(ws.project.id, scenarioId);
    assert.ok(page);
    assert.equal(page!.status, "error");
    assert.match(page!.error ?? "", /heap out of memory/i);
  });
});

describe("pass-49 MCP run_analysis budget", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-pass49-mcp-${Date.now()}-${Math.random()}`;
    process.env.UPC_ANALYSIS_SYNC = "0";
    services.setAnalysisDelayForTests(0);
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.UPC_ANALYSIS_SYNC;
    delete process.env.UPC_PAGE_TOOL_BUDGET_MS;
    services.setAnalysisDelayForTests(0);
  });

  it("run_analysis returns ANALYSIS_IN_PROGRESS before heavy work exceeds budget", async () => {
    process.env.UPC_PAGE_TOOL_BUDGET_MS = "100";
    services.setAnalysisDelayForTests(500);

    const ws = await services.createProject({
      name: "Pass 49 in-progress",
      objectiveText: HOUSING_OBJECTIVE,
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

    await new Promise((resolve) => setTimeout(resolve, 800));
    const status = await services.getAnalysisRunStatus(ws.project.id, scenarioId);
    assert.equal(status.status, "completed");
    assert.ok((status.candidateCount ?? 0) > 0);
  });

  it("persists compact candidates on disk after housing analysis", async () => {
    process.env.UPC_ANALYSIS_SYNC = "1";
    const ws = await services.createProject({
      name: "Pass 49 persist compact",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    const raw = await fs.readFile(getStorePath(), "utf8");
    assert.ok(!raw.includes('"coordinates":[') || !/"candidates"[\s\S]*"coordinates":\[\[\[/.test(raw));
    const parsed = JSON.parse(raw) as {
      analysisResults: Array<{ candidates: Array<{ geometry?: unknown; provenance?: unknown }> }>;
    };
    for (const result of parsed.analysisResults) {
      for (const candidate of result.candidates) {
        assert.equal(candidate.geometry, undefined);
        assert.equal(candidate.provenance, undefined);
      }
    }
  });
});
