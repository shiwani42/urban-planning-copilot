import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import {
  clearStoreCache,
  getStorePath,
  reloadStoreFromDisk,
  resetStore,
} from "./store";
import {
  enableInMemoryPostgresForTests,
  loadStorePayloadFromPostgres,
  resetPostgresBackendForTests,
  seedInMemoryPostgresRawTextForTests,
} from "./store-postgres";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import { isCompactCandidate } from "./analysis-candidates";
import { getPageToolBudgetMs } from "@/lib/webmcp/page-tool-budget";
import { bloatedStoreFixture } from "./pass-51-fixture";

const HOUSING_OBJECTIVE =
  "Find infill housing sites in San Francisco that sit within a 10-minute walk of frequent transit, stay out of FEMA flood zones, and can deliver at least 50 units without displacing existing parks or schools.";

describe("pass-51 legacy load compaction", () => {
  let tmpDir: string;
  let previousDataDir: string | undefined;
  let previousDatabaseUrl: string | undefined;

  beforeEach(async () => {
    tmpDir = `/tmp/upc-pass51-${Date.now()}-${Math.random()}`;
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
  });

  it("loads 1500-polygon fixture from postgres without retaining polygon geometry", async () => {
    const raw = bloatedStoreFixture(1500);
    assert.ok(Buffer.byteLength(raw, "utf8") > 800_000);

    seedInMemoryPostgresRawTextForTests(raw);

    const reloadedRaw = await loadStorePayloadFromPostgres();
    assert.ok(reloadedRaw);
    const reloadedParsed = JSON.parse(reloadedRaw!) as {
      analysisResults: Array<{ candidates: Array<{ geometry?: unknown }> }>;
    };
    for (const result of reloadedParsed.analysisResults) {
      for (const candidate of result.candidates) {
        assert.equal(candidate.geometry, undefined);
      }
    }

    clearStoreCache();
    const store = await reloadStoreFromDisk();
    const result = store.analysisResults.find((r) => r.id === "res-1");
    assert.ok(result);
    assert.equal(result!.candidates.length, 1500);
    assert.ok(result!.candidates.every((c) => c.geometry.type === "Point"));
    assert.ok(result!.candidates.every((c) => isCompactCandidate(c)));

    const page = await services.listCandidatesPage("proj-1", "sc-1", 10, 0);
    assert.ok(page);
    assert.equal(page!.status, "ok");
    assert.equal(page!.totalCount, 1500);
    assert.equal(page!.candidates.length, 10);
  });

  it("migrates bloated file cache on load and rewrites compact store.json", async () => {
    const raw = bloatedStoreFixture(1500);
    delete process.env.DATABASE_URL;
    resetPostgresBackendForTests();
    await fs.mkdir(tmpDir, { recursive: true });
    await fs.writeFile(getStorePath(), raw, "utf8");

    clearStoreCache();
    await reloadStoreFromDisk();

    const rewritten = await fs.readFile(getStorePath(), "utf8");
    const parsed = JSON.parse(rewritten) as {
      analysisResults: Array<{ candidates: Array<{ geometry?: unknown }> }>;
    };
    for (const result of parsed.analysisResults) {
      for (const candidate of result.candidates) {
        assert.equal(candidate.geometry, undefined);
      }
    }
  });
});

describe("pass-51 housing re-run after legacy load", () => {
  let previousDatabaseUrl: string | undefined;

  beforeEach(async () => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    process.env.DATA_DIR = `/tmp/upc-pass51-rerun-${Date.now()}-${Math.random()}`;
    process.env.UPC_ANALYSIS_SYNC = "1";
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.UPC_ANALYSIS_SYNC;
    process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("housing analysis still differentiates scores after compact legacy load", async () => {
    const ws = await services.createProject({
      name: "Pass 51 rerun",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    const page = await services.listCandidatesPage(
      ws.project.id,
      ws.project.activeScenarioId!,
      50,
      0
    );
    assert.ok(page);
    assert.equal(page!.status, "ok");
    const scores = page!.candidates.map((c) => c.score);
    assert.ok(new Set(scores).size > 1);
    assert.ok((page!.scoreSpread ?? 0) > 0);
  });
});

describe("pass-51 MCP run_analysis on boot with legacy postgres row", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = `/tmp/upc-pass51-mcp-${Date.now()}-${Math.random()}`;
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

  it("run_analysis returns ANALYSIS_IN_PROGRESS within budget after loading legacy row", async () => {
    seedInMemoryPostgresRawTextForTests(bloatedStoreFixture(1500));
    clearStoreCache();
    const booted = await reloadStoreFromDisk();
    assert.ok(booted.projects.length > 0);

    const ws = await services.createProject({
      name: "Pass 51 after legacy boot",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;

    process.env.UPC_PAGE_TOOL_BUDGET_MS = "100";
    services.setAnalysisDelayForTests(500);

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

    await new Promise((resolve) => setTimeout(resolve, 800));
    const status = await services.getAnalysisRunStatus(ws.project.id, scenarioId);
    assert.equal(status.status, "completed");
    assert.ok((status.candidateCount ?? 0) > 0);
  });
});
