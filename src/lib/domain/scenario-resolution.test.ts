import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeScenarioNeedsRepair,
  pickDefaultScenarioId,
  resolveScenarioId,
} from "./scenario-resolution";
import type { AppStore, Project, Scenario } from "./types";

function makeStore(
  project: Partial<Project> & { id: string },
  scenarios: Array<Partial<Scenario> & { id: string; projectId: string; name: string }>
): AppStore {
  return {
    projects: [
      {
        name: "Test",
        createdAt: "",
        updatedAt: "",
        geographyLabel: "SF",
        mapState: {} as Project["mapState"],
        ...project,
      } as Project,
    ],
    scenarios: scenarios.map(
      (s) =>
        ({
          status: "draft",
          constraints: [],
          weights: [],
          assumptions: [],
          geographicSelections: [],
          enabledDatasetIds: [],
          decisionStatus: "none",
          createdAt: "",
          updatedAt: "",
          annotations: [],
          ...s,
        }) as Scenario
    ),
  } as AppStore;
}

describe("scenario-resolution", () => {
  it("prefers Baseline when active scenario id is missing", () => {
    const store = makeStore(
      { id: "p1", activeScenarioId: undefined },
      [
        { id: "s-branch", projectId: "p1", name: "Pass 20 study" },
        { id: "s-base", projectId: "p1", name: "Baseline" },
      ]
    );
    assert.equal(pickDefaultScenarioId(store.scenarios), "s-base");
    assert.equal(resolveScenarioId(store, "p1", "missing-id"), "s-base");
    assert.equal(activeScenarioNeedsRepair(store, "p1"), "s-base");
  });

  it("falls back to active scenario when request id is stale", () => {
    const store = makeStore(
      { id: "p1", activeScenarioId: "s-active" },
      [
        { id: "s-active", projectId: "p1", name: "Pass 20 study" },
        { id: "s-base", projectId: "p1", name: "Baseline" },
      ]
    );
    assert.equal(resolveScenarioId(store, "p1", "deleted-scenario"), "s-active");
    assert.equal(activeScenarioNeedsRepair(store, "p1"), undefined);
  });
});
