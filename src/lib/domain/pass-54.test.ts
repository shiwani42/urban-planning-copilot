import assert from "node:assert/strict";
import { test } from "node:test";
import { applyShortlistMutation } from "./shortlist-optimistic";
import { documentsPatchFromStore } from "./store-postgres";
import { pickContinueProjects } from "../home-continue";
import { CLIENT_STUDY_CONTINUE_NAME, RANKING_STALE_FALLBACK } from "../planner-copy";
import { featureIdsOutsideFloodCoverage } from "./flood-coverage";
import { displayGeographyLabel } from "./study-bounds";
import { rankingStaleVersusObjective } from "./housing-target";
import { paginateCandidatesCompact } from "./analysis-candidates";
import type { AnalysisResult, AppStore, WorkspaceSnapshot } from "./types";

test("documents persist patch omits analysis results and GIS catalog", () => {
  const store = {
    version: 8,
    projects: [{ id: "p1" }],
    scenarios: [],
    analysisResults: [{ id: "fat" }],
    analysisJobs: [{ id: "job" }],
    datasets: [{ id: "ds" }],
    featuresByDataset: { ds: { type: "FeatureCollection", features: [] } },
    reports: [],
    decisions: [],
    activities: [],
    confirmations: [],
    proposals: [],
  } as unknown as AppStore;

  const patch = documentsPatchFromStore(store);
  assert.equal(patch.version, 8);
  assert.ok(patch.projects);
  assert.ok(patch.analysisJobs);
  assert.equal("analysisResults" in patch, false);
  assert.equal("datasets" in patch, false);
  assert.equal("featuresByDataset" in patch, false);
});

test("home continue prefers the client demo card and hides the duplicate Mission/SoMa study", () => {
  const now = new Date().toISOString();
  const picked = pickContinueProjects(
    [
      {
        id: "infill",
        name: "Mission/SoMa infill — 2,000 homes",
        updatedAt: now,
        lastOpenedAt: now,
        geographyLabel: "Mission/SoMa, San Francisco",
      },
      {
        id: "demo",
        name: CLIENT_STUDY_CONTINUE_NAME,
        updatedAt: now,
        lastOpenedAt: now,
        geographyLabel: "Mission/SoMa, San Francisco",
      },
    ],
    1
  );
  assert.equal(picked.length, 1);
  assert.equal(picked[0]?.id, "demo");
});

test("optimistic pin adds the candidate without waiting on persist", () => {
  const workspace = {
    project: { id: "p", activeScenarioId: "s" },
    scenarios: [{ id: "s", projectId: "p", shortlist: [], latestResultId: "r" }],
    analysisResults: [
      {
        id: "r",
        candidates: [{ id: "c1", label: "Lot A", featureIds: ["c1"], score: 80, rank: 1 }],
      },
    ],
  } as unknown as WorkspaceSnapshot;
  const next = applyShortlistMutation(workspace, { action: "pin", candidateId: "c1" });
  const scenario = next.scenarios.find((s) => s.id === "s");
  assert.equal(scenario?.shortlist?.length, 1);
  assert.equal(scenario?.shortlist?.[0]?.candidateId, "c1");
  assert.equal(workspace.scenarios[0]?.shortlist?.length ?? 0, 0);
});

test("geography never shows Study area on planner surfaces", () => {
  assert.equal(displayGeographyLabel("Study area"), "Mission/SoMa, San Francisco");
  assert.equal(displayGeographyLabel("Mission/SoMa, San Francisco"), "Mission/SoMa, San Francisco");
});

test("ranking is stale when the brief target no longer matches the last run", () => {
  const result = {
    aggregateMetrics: [
      {
        key: "housing_target_gap",
        inputs: { target_homes: 50 },
      },
    ],
  } as unknown as Parameters<typeof rankingStaleVersusObjective>[0];
  assert.equal(rankingStaleVersusObjective(result, 2000), true);
  assert.equal(rankingStaleVersusObjective(result, 50), false);
  assert.match(RANKING_STALE_FALLBACK, /Ranking may not match/);
});

test("list_candidates compact page never includes geometries", () => {
  const result = {
    candidates: [
      {
        id: "c1",
        label: "Lot A",
        rank: 1,
        score: 94.3,
        status: "eligible",
        geometry: { type: "Polygon", coordinates: [] },
        centroid: [-122.41, 37.76],
        featureIds: ["c1"],
        metrics: [],
        provenance: {},
      },
    ],
    summary: "Ranked",
    stale: false,
    scoreSpread: 12,
    candidateCount: 1,
  } as unknown as AnalysisResult;
  const page = paginateCandidatesCompact(result, 10, 0);
  assert.equal(page.candidates.length, 1);
  assert.equal("geometry" in page.candidates[0]!, false);
  assert.equal("centroid" in page.candidates[0]!, false);
  assert.deepEqual(Object.keys(page.candidates[0]!).sort(), [
    "id",
    "label",
    "rank",
    "score",
    "status",
  ]);
});
