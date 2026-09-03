import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveHousingTarget,
  topSiteCapacityFromResult,
  totalCapacityFromResult,
} from "./housing-target";
import type { AnalysisResult, Candidate } from "./types";

function mockCandidate(rank: number, capacity: number): Candidate {
  return {
    id: `c-${rank}`,
    label: `Site ${rank}`,
    featureIds: [`f-${rank}`],
    geometry: { type: "Point", coordinates: [0, 0] },
    centroid: [0, 0],
    score: 90 - rank,
    rank,
    metrics: [{ key: "capacity", label: "Capacity", value: capacity, kind: "calculated" }],
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
  };
}

describe("housing-target", () => {
  it("resolves target from objective, project title, or raw text", () => {
    assert.equal(
      resolveHousingTarget({
        intent: "housing_capacity",
        objectiveTarget: 2000,
        projectName: "Pass25 Mission 600 homes",
      }),
      2000
    );
    assert.equal(
      resolveHousingTarget({
        intent: "housing_capacity",
        projectName: "Pass25 Mission 600 homes",
        objectiveRawText: "Find housing near transit",
      }),
      600
    );
    assert.equal(
      resolveHousingTarget({
        intent: "housing_capacity",
        objectiveRawText: "Deliver 2,000 homes near transit",
      }),
      2000
    );
  });

  it("sums candidate capacity when aggregate metric is missing", () => {
    const result = {
      id: "r1",
      scenarioId: "s1",
      status: "completed",
      candidates: [mockCandidate(1, 13), mockCandidate(2, 10)],
      aggregateMetrics: [],
      summary: "",
      limitations: [],
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies AnalysisResult;

    assert.equal(totalCapacityFromResult(result), 23);
    assert.equal(topSiteCapacityFromResult(result), 13);
  });
});
