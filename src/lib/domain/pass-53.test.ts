import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allPlannerCopyStrings,
  containsForbiddenPlannerCopy,
  exploreSuggestedProjectName,
  toPlannerStorageMessage,
  EPHEMERAL_SAVE_MESSAGE,
  SAVE_UNAVAILABLE_FALLBACK,
  PLANNER_GEOGRAPHY_LABEL,
} from "../planner-copy";
import {
  EPHEMERAL_STORAGE_BANNER_MESSAGE,
  storageReliabilityIssue,
  type ClientStorageStatus,
} from "../storage-status";
import { NEW_PROJECT_EXAMPLES } from "../new-project-preview";
import { GEOGRAPHY_LABEL } from "./study-bounds";
import {
  buildExploreConvertDraft,
  runExploreInvestigation,
} from "./explore";
import { generateSyntheticCity } from "./seed";

function cityLayers(seed = 3) {
  const city = generateSyntheticCity(seed);
  const layers: Record<string, GeoJSON.FeatureCollection> = {};
  for (const d of city.datasets) {
    layers[d.kind] = city.featuresByDataset[d.id];
  }
  return {
    layers,
    datasetIds: Object.fromEntries(city.datasets.map((d) => [d.kind, d.id])),
    datasets: city.datasets,
  };
}

const FORBIDDEN_SAMPLES = [
  "Neon Persist Probe 46",
  "Pass 40 Persist Test",
  "Set DATABASE_URL for durable Postgres storage",
  "Workspace catalog uses ephemeral file storage",
  "nekuda WebMCP Workbench",
  "UrbanSight AI",
  "XiBoAdzYqlBYb7VgWvI53",
  "open-data sandbox",
  "this build",
  "Render free tier",
];

describe("pass 53 planner-facing copy", () => {
  it("exports no forbidden builder or QA terminology", () => {
    for (const text of allPlannerCopyStrings()) {
      assert.equal(
        containsForbiddenPlannerCopy(text),
        false,
        `forbidden term in planner copy: ${text}`
      );
    }
  });

  it("rejects known bad copy samples", () => {
    for (const sample of FORBIDDEN_SAMPLES) {
      assert.equal(containsForbiddenPlannerCopy(sample), true, sample);
    }
  });

  it("uses planner geography label consistently", () => {
    assert.equal(GEOGRAPHY_LABEL, PLANNER_GEOGRAPHY_LABEL);
    assert.match(GEOGRAPHY_LABEL, /Mission\/SoMa/);
    assert.doesNotMatch(GEOGRAPHY_LABEL, /demo area/i);
  });

  it("uses planner example project titles not QA labels", () => {
    assert.ok(NEW_PROJECT_EXAMPLES.length >= 4);
    for (const ex of NEW_PROJECT_EXAMPLES) {
      assert.doesNotMatch(ex.title, /^(Housing growth|Transit|Schools|Climate resilience)$/);
      assert.doesNotMatch(ex.title, /Pass\s*\d+/i);
      assert.doesNotMatch(ex.title, /Probe|Persist Test/i);
    }
    assert.ok(
      NEW_PROJECT_EXAMPLES.some((e) => e.title.includes("Mission/SoMa")),
      "at least one example uses Mission/SoMa in the title"
    );
  });

  it("sanitizes infrastructure storage errors for planners", () => {
    assert.equal(
      toPlannerStorageMessage("Postgres write probe failed", SAVE_UNAVAILABLE_FALLBACK),
      SAVE_UNAVAILABLE_FALLBACK
    );
    assert.equal(
      toPlannerStorageMessage("ENOENT: store.json missing", SAVE_UNAVAILABLE_FALLBACK),
      SAVE_UNAVAILABLE_FALLBACK
    );
    assert.equal(
      toPlannerStorageMessage("Custom planner-safe message", SAVE_UNAVAILABLE_FALLBACK),
      "Custom planner-safe message"
    );
  });

  it("storage banner messages avoid DATABASE_URL and Postgres", () => {
    assert.equal(containsForbiddenPlannerCopy(EPHEMERAL_STORAGE_BANNER_MESSAGE), false);
    const degraded: ClientStorageStatus = {
      status: "degraded",
      persistBackend: "postgres",
      postgresOk: false,
      writeProbeOk: false,
      message: "Postgres write probe failed",
    };
    const issue = storageReliabilityIssue(degraded);
    assert.ok(issue);
    assert.equal(containsForbiddenPlannerCopy(issue), false);
  });

  it("explore convert suggests planner project names", () => {
    const layers = cityLayers();
    const result = runExploreInvestigation({
      question: "Where are transit accessibility gaps largest?",
      ...layers,
    });
    const draft = buildExploreConvertDraft(result);
    assert.equal(draft.suggestedName, exploreSuggestedProjectName("transit_gap"));
    assert.doesNotMatch(draft.suggestedName, /^Explore —/);
  });
});
