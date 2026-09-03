import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  activeScenarioNeedsRepair,
  defaultCompareScenarioIds,
  pickDefaultScenarioId,
  resolveScenarioId,
} from "./scenario-resolution";
import type { AnalysisResult, AppStore, Candidate, Project, Scenario } from "./types";

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

  it("defaultCompareScenarioIds prefers active scenario and parent, not all branches", () => {
    const candidates: Candidate[] = [
      {
        id: "c1",
        label: "Site",
        featureIds: ["f1"],
        geometry: { type: "Point", coordinates: [0, 0] },
        centroid: [0, 0],
        score: 80,
        rank: 1,
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
        status: "eligible",
      },
    ];
    const results: AnalysisResult[] = [
      {
        id: "r1",
        scenarioId: "parent",
        status: "completed",
        stale: false,
        candidates,
        createdAt: "",
        completedAt: "",
        stepLogs: [],
        aggregateMetrics: [],
      },
      {
        id: "r2",
        scenarioId: "child",
        status: "completed",
        stale: false,
        candidates,
        createdAt: "",
        completedAt: "",
        stepLogs: [],
        aggregateMetrics: [],
      },
      {
        id: "r3",
        scenarioId: "other",
        status: "completed",
        stale: false,
        candidates,
        createdAt: "",
        completedAt: "",
        stepLogs: [],
        aggregateMetrics: [],
      },
    ];
    const scenarios: Scenario[] = [
      {
        id: "parent",
        projectId: "p1",
        name: "Baseline",
        parentScenarioId: undefined,
        latestResultId: "r1",
      } as Scenario,
      {
        id: "child",
        projectId: "p1",
        name: "Flood branch",
        parentScenarioId: "parent",
        latestResultId: "r2",
      } as Scenario,
      {
        id: "other",
        projectId: "p1",
        name: "Transit branch",
        parentScenarioId: "parent",
        latestResultId: "r3",
      } as Scenario,
    ];

    const ids = defaultCompareScenarioIds(scenarios, results, "child");
    assert.deepEqual(ids, ["child", "parent"]);
    assert.equal(ids.includes("other"), false);
  });
});
