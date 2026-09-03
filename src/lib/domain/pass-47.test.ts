import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resetStore } from "./store";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import { detectIntent, parseObjective, normalizeWeights } from "./objective";
import { runSpatialAnalysis } from "./spatial";
import { generateSyntheticCity } from "./seed";
import { PLANNING_TOOL_META } from "@/lib/webmcp/tool-definitions";
import type { JsonSchema } from "@/lib/webmcp/browser-types";
import {
  coerceBrowserToolFailure,
  webMcpToolOk,
} from "@/lib/webmcp/tool-result";
import {
  isPageToolTimeoutOrAbortMessage,
  PageToolBudgetExceeded,
  runWithPageToolBudget,
} from "@/lib/webmcp/page-tool-budget";
import { headlineMetric } from "./results-display";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

const INfill_OBJECTIVE =
  "Find infill housing sites in San Francisco that sit within a 10-minute walk of frequent transit, stay out of FEMA flood zones, and can deliver at least 50 units without displacing existing parks or schools.";

function collectPropertySchemas(schema: JsonSchema, missing: string[], prefix = ""): void {
  if (!schema.properties) return;
  for (const [key, value] of Object.entries(schema.properties)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value.type && value.type !== "object" && value.type !== "array" && !value.description) {
      missing.push(path);
    }
    if (value.properties) collectPropertySchemas(value, missing, path);
    if (value.items && typeof value.items === "object" && !Array.isArray(value.items)) {
      collectPropertySchemas(value.items, missing, `${path}[]`);
    }
  }
}

describe("pass-47 WebMCP timeouts and errors", () => {
  it("timeout and abort messages are not serialized as ok", () => {
    const message =
      "Input validation error from page tool 'list_candidates': Timed out waiting for page tool 'list_candidates'.";
    assert.equal(isPageToolTimeoutOrAbortMessage(message), true);
    const wrapped = webMcpToolOk(message);
    assert.equal(wrapped.isError, true);
    assert.match(wrapped.content[0]?.text ?? "", /Timed out waiting/i);
  });

  it("coerceBrowserToolFailure maps AbortError to isError", () => {
    const err = Object.assign(new Error("Aborted"), { name: "AbortError" });
    const result = coerceBrowserToolFailure(err);
    assert.equal(result.isError, true);
    assert.match(result.content[0]?.text ?? "", /Timed out/i);
  });

  it("runWithPageToolBudget rejects when work exceeds budget", async () => {
    await assert.rejects(
      () =>
        runWithPageToolBudget(async () => {
          await new Promise((resolve) => setTimeout(resolve, 40));
          return "late";
        }, 20),
      (err: unknown) => err instanceof PageToolBudgetExceeded
    );
  });
});

describe("pass-47 scoring and intent", () => {
  it("infill housing objective with parks and schools stays housing_capacity", () => {
    assert.equal(detectIntent(INfill_OBJECTIVE), "housing_capacity");
  });

  it("differentiates scores when school/population layers are missing", () => {
    const city = generateSyntheticCity(7);
    assert.equal(detectIntent(INfill_OBJECTIVE), "housing_capacity");
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
    assert.ok(out.candidates.length > 1);
    const scores = out.candidates.map((c) => c.score);
    const unique = new Set(scores);
    assert.ok(unique.size > 1, `expected differentiated scores, got ${[...unique].join(", ")}`);
    assert.ok(!scores.every((score) => score === 50), "scores must not all tie at 50");
  });

  it("headlineMetric hides school access headline when school data is missing", () => {
    const headline = headlineMetric(
      "service_access",
      [{ key: "total_school_underserved_pop", label: "Population lacking school access", value: 0 }],
      { limitations: ["Schools dataset unavailable — school access metrics cannot be computed"] }
    );
    assert.equal(headline, null);
  });
});

describe("pass-47 tool schema descriptions", () => {
  it("every tool property includes a description", () => {
    const missing: string[] = [];
    for (const tool of PLANNING_TOOL_META) {
      collectPropertySchemas(tool.inputSchema, missing, tool.name);
    }
    assert.deepEqual(missing, []);
  });
});

describe("pass-47 run_analysis persistence", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-pass47-${Date.now()}-${Math.random()}`;
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  it("run_analysis still persists analysis visible to list_candidates", async () => {
    const ws = await services.createProject({
      name: "Pass 47 analysis",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    const run = await invokeTool("run_analysis", {
      projectId: ws.project.id,
      scenarioId,
    });
    assert.equal(run.ok, true);
    if (run.ok) {
      const payload = run.result as { status: string; candidateCount?: number };
      assert.equal(payload.status, "completed");
      assert.ok((payload.candidateCount ?? 0) > 0);
    }

    const listed = await invokeTool("list_candidates", {
      projectId: ws.project.id,
      scenarioId,
      limit: 5,
    });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      const candidates = (listed.result as { candidates?: unknown[] }).candidates ?? [];
      assert.ok(candidates.length > 0);
    }
  });

  it("list_candidates and set_map_view return quickly on a loaded workspace", async () => {
    const ws = await services.createProject({
      name: "Pass 47 latency",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await invokeTool("run_analysis", { projectId: ws.project.id, scenarioId });

    const listStarted = Date.now();
    const listed = await invokeTool("list_candidates", {
      projectId: ws.project.id,
      scenarioId,
      limit: 3,
    });
    assert.equal(listed.ok, true);
    assert.ok(Date.now() - listStarted < 3000, "list_candidates should stay well under page-tool budget");

    const mapStarted = Date.now();
    const map = await invokeTool("set_map_view", {
      projectId: ws.project.id,
      center: [-122.415, 37.765],
      zoom: 14,
    });
    assert.equal(map.ok, true);
    assert.ok(Date.now() - mapStarted < 3000, "set_map_view should stay well under page-tool budget");
  });
});
