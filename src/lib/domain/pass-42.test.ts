import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { assessExploreQuestion } from "./explore";
import { resetStore } from "./store";
import * as services from "./services";
import { loadSharedStoreCatalog } from "./storage-diagnostics";
import { SERVER_WAKE_THRESHOLD_MS } from "../server-wake";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("pass 42 planner friction", () => {
  it("routes explore flood exposure questions", () => {
    const assessed = assessExploreQuestion("Which areas have the highest flood exposure?");
    assert.equal(assessed.supported, true);
    assert.equal(assessed.analysisType, "flood_exposure");
  });

  it("uses a 3s server wake threshold", () => {
    assert.equal(SERVER_WAKE_THRESHOLD_MS, 3000);
  });
});

describe("catalog list/get consistency", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-catalog-test-${Date.now()}-${Math.random()}`;
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  it("lists only projects that getWorkspace can load from the same snapshot", async () => {
    const ws = await services.createProject({
      name: "Catalog parity",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const catalog = await loadSharedStoreCatalog();
    const dashboard = services.listHomeDashboardFromStore(catalog.store);

    assert.equal(catalog.listableProjectCount, dashboard.projects.length);
    assert.ok(dashboard.projects.some((p) => p.id === ws.project.id));

    for (const project of dashboard.projects) {
      assert.ok(
        services.getWorkspaceFromStore(catalog.store, project.id),
        `listed project ${project.id} must load from catalog store`
      );
      const loaded = await services.getWorkspace(project.id);
      assert.ok(loaded, `GET workspace must succeed for listed project ${project.id}`);
    }
  });
});
