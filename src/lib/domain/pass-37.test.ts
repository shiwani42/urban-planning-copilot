import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIVITY_FILTER_LABELS,
  matchesActivityFilter,
  activityCategoryLabel,
} from "../activity-filters";
import { buildNewProjectPreview, NEW_PROJECT_EXAMPLES } from "../new-project-preview";
import { COMPARE_SYNCED_MAP_LIMIT } from "../../components/CompareScenarioMaps";
import type { ActivityEvent } from "../domain/types";

const baseEvent: Pick<ActivityEvent, "actor" | "category"> = {
  actor: "agent",
  category: "analysis",
};

describe("pass 37 activity filters", () => {
  it("exposes all six filter chip labels", () => {
    assert.deepEqual(Object.keys(ACTIVITY_FILTER_LABELS), [
      "all",
      "agent",
      "human",
      "analysis",
      "data",
      "decisions",
    ]);
  });

  it("matches agent filter for agent actor and agent category", () => {
    assert.equal(matchesActivityFilter({ actor: "agent", category: "analysis" }, "agent"), true);
    assert.equal(matchesActivityFilter({ actor: "system", category: "agent" }, "agent"), true);
    assert.equal(matchesActivityFilter({ actor: "human", category: "decision" }, "agent"), false);
  });

  it("matches human, analysis, data, and decisions filters", () => {
    assert.equal(matchesActivityFilter({ actor: "human", category: "objective" }, "human"), true);
    assert.equal(matchesActivityFilter(baseEvent, "analysis"), true);
    assert.equal(
      matchesActivityFilter({ actor: "system", category: "data" }, "data"),
      true
    );
    assert.equal(
      matchesActivityFilter({ actor: "human", category: "decision" }, "decisions"),
      true
    );
  });

  it("formats activity category labels", () => {
    assert.equal(activityCategoryLabel("decision"), "Decision");
    assert.equal(activityCategoryLabel("analysis"), "Analysis");
  });
});

describe("pass 37 new project preview", () => {
  it("returns empty preview for blank objective", () => {
    const preview = buildNewProjectPreview("");
    assert.equal(preview.confidence, "empty");
    assert.equal(preview.datasets.length, 0);
  });

  it("detects housing and transit datasets from objective text", () => {
    const preview = buildNewProjectPreview(NEW_PROJECT_EXAMPLES[0]!.text);
    assert.equal(preview.confidence, "ready");
    assert.ok(preview.datasets.includes("Parcels"));
    assert.ok(preview.datasets.includes("Transit"));
    assert.ok(preview.datasets.includes("Flood risk"));
    assert.ok(preview.analyses.some((a) => a.label === "Capacity estimation"));
  });

  it("includes four planner-style example questions", () => {
    assert.equal(NEW_PROJECT_EXAMPLES.length, 4);
    assert.ok(NEW_PROJECT_EXAMPLES.some((e) => e.title.includes("Mission/SoMa")));
  });
});

describe("pass 37 compare map cap", () => {
  it("syncs up to three scenario maps", () => {
    assert.equal(COMPARE_SYNCED_MAP_LIMIT, 3);
  });
});
