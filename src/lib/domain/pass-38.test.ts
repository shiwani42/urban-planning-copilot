import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { validateDecisionReason } from "./decision";
import { defaultCompareScenarioIds } from "./scenario-resolution";
import { candidateBelowHousingTarget } from "./results-filter";
import type { Candidate } from "./types";

describe("pass 38 planner correctness", () => {
  it("rejects empty decision reasons before approve/reject", () => {
    assert.equal(validateDecisionReason(""), "Please enter a reason — required for the audit trail.");
    assert.equal(validateDecisionReason("short"), "Reason must be at least 10 characters.");
    assert.equal(
      validateDecisionReason("Meets housing target with acceptable flood exposure."),
      null
    );
  });

  it("identifies candidates below housing target for yield-gap filtering", () => {
    const candidate = {
      id: "c1",
      label: "Site",
      featureIds: ["f1"],
      geometry: { type: "Point", coordinates: [0, 0] },
      centroid: [0, 0],
      score: 70,
      rank: 1,
      metrics: [{ key: "capacity", label: "Capacity", value: 400, unit: "homes" }],
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
    } as Candidate;

    assert.equal(candidateBelowHousingTarget(candidate, 1000), true);
    assert.equal(candidateBelowHousingTarget(candidate, 300), false);
  });

  it("defaultCompareScenarioIds caps selection for multi-branch projects", () => {
    const makeResult = (scenarioId: string) => ({
      id: `r-${scenarioId}`,
      scenarioId,
      status: "completed" as const,
      stale: false,
      candidates: [
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
          status: "eligible" as const,
        },
      ],
      createdAt: "",
      completedAt: "",
      stepLogs: [],
      aggregateMetrics: [],
    });

    const scenarios = ["a", "b", "c", "d"].map((id) => ({
      id,
      projectId: "p1",
      name: id,
      parentScenarioId: id === "a" ? undefined : "a",
      latestResultId: `r-${id}`,
    })) as Parameters<typeof defaultCompareScenarioIds>[0];

    const results = scenarios.map((s) => makeResult(s.id));
    const ids = defaultCompareScenarioIds(scenarios, results, "b");
    assert.equal(ids.length, 2);
    assert.deepEqual(ids, ["b", "a"]);
  });
});
