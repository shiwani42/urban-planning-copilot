import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  clearStoreCache,
  getStorePath,
  reloadStoreFromDisk,
  resetStore,
  updateStore,
} from "./store";
import {
  enableInMemoryPostgresForTests,
  loadStorePayloadFromPostgres,
  resetPostgresBackendForTests,
  seedInMemoryPostgresRawTextForTests,
} from "./store-postgres";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import { getPageToolBudgetMs } from "@/lib/webmcp/page-tool-budget";
import { bloatedStoreFixture } from "./pass-51-fixture";
import { dedupeAnalysisResultsPerScenario } from "./analysis-candidates";

const HOUSING_OBJECTIVE =
  "Find infill housing sites in San Francisco that sit within a 10-minute walk of frequent transit, stay out of FEMA flood zones, and can deliver at least 50 units without displacing existing parks or schools.";

describe("pass-52 postgres never writes store.json", () => {
  let tmpDir: string;
  let previousDataDir: string | undefined;
  let previousDatabaseUrl: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass52-"));
    previousDataDir = process.env.DATA_DIR;
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATA_DIR = tmpDir;
    process.env.DATABASE_URL = "postgres://test:test@localhost/test";
    resetPostgresBackendForTests();
    enableInMemoryPostgresForTests();
    await resetStore();
  });

  afterEach(async () => {
    clearStoreCache();
    resetPostgresBackendForTests();
    process.env.DATA_DIR = previousDataDir;
    process.env.DATABASE_URL = previousDatabaseUrl;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("persist mutations do not create store.json when postgres is primary", async () => {
    const ws = await services.createProject({
      name: "Pass 52 no file cache",
      objectiveText: HOUSING_OBJECTIVE,
    });
    process.env.UPC_ANALYSIS_SYNC = "1";
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    delete process.env.UPC_ANALYSIS_SYNC;

    await fs.rm(getStorePath(), { force: true });
    await updateStore((store) => {
      const project = store.projects.find((p) => p.id === ws.project.id);
      if (project) project.resumeNote = "postgres only";
    });

    let exists = false;
    try {
      await fs.access(getStorePath());
      exists = true;
    } catch {
      exists = false;
    }
    assert.equal(exists, false, "store.json must not be written when postgres is primary");
  });

  it("boot from postgres does not write store.json", async () => {
    seedInMemoryPostgresRawTextForTests(bloatedStoreFixture(200));
    clearStoreCache();
    await reloadStoreFromDisk();

    let exists = false;
    try {
      await fs.access(getStorePath());
      exists = true;
    } catch {
      exists = false;
    }
    assert.equal(exists, false);
  });
});

describe("pass-52 analysis result dedupe", () => {
  it("keeps only latestResultId per scenario", () => {
    const store = {
      scenarios: [{ id: "sc-1", latestResultId: "res-2" }],
      analysisResults: [
        { id: "res-1", scenarioId: "sc-1", status: "stale" as const, candidates: [] },
        { id: "res-2", scenarioId: "sc-1", status: "completed" as const, candidates: [] },
      ],
    };
    assert.equal(dedupeAnalysisResultsPerScenario(store), true);
    assert.equal(store.analysisResults.length, 1);
    assert.equal(store.analysisResults[0]!.id, "res-2");
  });
});

describe("pass-52 housing re-run replaces stale flat scores", () => {
  let previousDatabaseUrl: string | undefined;

  beforeEach(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    process.env.DATA_DIR = `/tmp/upc-pass52-rerun-${Date.now()}-${Math.random()}`;
    process.env.UPC_ANALYSIS_SYNC = "1";
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.UPC_ANALYSIS_SYNC;
    if (previousDatabaseUrl !== undefined) {
      process.env.DATABASE_URL = previousDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
  });

  it("second run replaces stale service-access flat 50s with housing spread scores", async () => {
    const ws = await services.createProject({
      name: "Pass 52 housing rerun",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;

    await updateStore((store) => {
      const scenario = store.scenarios.find((s) => s.id === scenarioId)!;
      scenario.objective = { ...scenario.objective, intent: "service_access" };
      const staleResult = {
        id: "stale-flat",
        jobId: "old-job",
        scenarioId,
        status: "completed" as const,
        createdAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.000Z",
        candidates: Array.from({ length: 20 }, (_, i) => ({
          id: `flat-${i}`,
          label: `Parcel ${i}`,
          featureIds: [`f-${i}`],
          geometry: { type: "Point" as const, coordinates: [0, 0] as [number, number] },
          centroid: [0, 0] as [number, number],
          score: 50,
          rank: i + 1,
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
          status: "eligible" as const,
        })),
        aggregateMetrics: [],
        summary: "Ranked by service-access gaps",
        stepLogs: [],
        limitations: [],
        stale: true,
        scoreSpread: 0,
        candidateCount: 20,
      };
      store.analysisResults.push(staleResult);
      scenario.latestResultId = staleResult.id;
    });

    await services.runAnalysis(ws.project.id, scenarioId);
    const after = await services.getWorkspace(ws.project.id);
    const scenario = after!.scenarios.find((s) => s.id === scenarioId)!;
    assert.equal(scenario.objective.intent, "housing_capacity");

    const result = after!.analysisResults.find((r) => r.id === scenario.latestResultId);
    assert.ok(result);
    assert.equal(result!.stale, false);
    assert.ok((result!.scoreSpread ?? 0) > 0);
    const scores = result!.candidates.map((c) => c.score);
    assert.ok(new Set(scores).size > 1);
    assert.ok(!scores.every((s) => s === 50));
    assert.doesNotMatch(result!.summary ?? "", /service-access gaps/i);

    const scenarioResults = after!.analysisResults.filter((r) => r.scenarioId === scenarioId);
    assert.equal(scenarioResults.length, 1);
  });
});

describe("pass-52 MCP run_analysis in-progress", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = `/tmp/upc-pass52-mcp-${Date.now()}-${Math.random()}`;
    process.env.DATA_DIR = tmpDir;
    process.env.DATABASE_URL = "postgres://test:test@localhost/test";
    process.env.UPC_ANALYSIS_SYNC = "0";
    services.setAnalysisDelayForTests(0);
    resetPostgresBackendForTests();
    enableInMemoryPostgresForTests();
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.DATABASE_URL;
    delete process.env.UPC_ANALYSIS_SYNC;
    delete process.env.UPC_PAGE_TOOL_BUDGET_MS;
    services.setAnalysisDelayForTests(0);
    resetPostgresBackendForTests();
  });

  it("returns ANALYSIS_IN_PROGRESS before job completes when stale result exists", async () => {
    seedInMemoryPostgresRawTextForTests(bloatedStoreFixture(400));
    clearStoreCache();
    await reloadStoreFromDisk();

    const ws = await services.createProject({
      name: "Pass 52 stale in-progress",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;

    process.env.UPC_PAGE_TOOL_BUDGET_MS = "100";
    services.setAnalysisDelayForTests(600);

    const started = Date.now();
    const run = await invokeTool("run_analysis", {
      projectId: ws.project.id,
      scenarioId,
    });
    assert.ok(Date.now() - started < getPageToolBudgetMs() + 2500);
    assert.equal(run.ok, false);
    if (!run.ok) {
      assert.equal(run.error.code, "ANALYSIS_IN_PROGRESS");
    }

    await new Promise((resolve) => setTimeout(resolve, 900));
    const status = await services.getAnalysisRunStatus(ws.project.id, scenarioId);
    assert.equal(status.status, "completed");
    assert.ok((status.candidateCount ?? 0) > 0);
    if (status.status === "completed") {
      assert.equal(status.stale, false);
      assert.ok(!status.summary?.match(/service-access gaps/i));
    }

    const store = await import("./store").then((m) => m.getStore());
    const scenarioResults = store.analysisResults.filter((r) => r.scenarioId === scenarioId);
    assert.equal(scenarioResults.length, 1);
  });
});
