import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateCapacityHomes,
  filterCandidates,
  floodRiskBandForCandidate,
} from "./results-filter";
import type { Candidate } from "./types";
import * as services from "./services";

const HOUSING_OBJECTIVE =
  "Deliver 2,000 new homes near transit while avoiding high flood risk.";

function mockCandidate(overrides: Partial<Candidate> & { id: string; label: string }): Candidate {
  return {
    featureIds: [overrides.id],
    geometry: { type: "Point", coordinates: [0, 0] },
    centroid: [0, 0],
    score: 55,
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
    ...overrides,
  };
}

describe("pass-27 hardening", () => {
  it("listProjects exposes scenario summary when multiple branches exist", async () => {
    const ws = await services.createProject({
      name: "Multi branch home card",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, baselineId);
    await services.createScenario(ws.project.id, "Flood-weighted branch", baselineId);

    const listed = await services.listProjects();
    const item = listed.find((p) => p.id === ws.project.id);
    assert.ok(item);
    assert.equal(item.scenarioCount, 2);
    assert.match(item.scenarioSummary ?? "", /Baseline/);
    assert.match(item.scenarioSummary ?? "", /Flood-weighted/);
  });

  it("filters candidates by flood risk band and capacity homes", () => {
    const candidates = [
      mockCandidate({
        id: "a",
        label: "Mission — Blk/Lot 1",
        score: 80,
        rank: 1,
        metrics: [
          { key: "flood_resilience", label: "Flood", value: 90, kind: "calculated" },
          { key: "capacity", label: "Capacity", value: 40, kind: "calculated" },
        ],
      }),
      mockCandidate({
        id: "b",
        label: "SoMa — Blk/Lot 2",
        score: 45,
        rank: 2,
        metrics: [
          { key: "flood_resilience", label: "Flood", value: 20, kind: "calculated" },
          { key: "capacity", label: "Capacity", value: 120, kind: "calculated" },
        ],
      }),
    ];

    assert.equal(floodRiskBandForCandidate(candidates[0]!), "low");
    assert.equal(floodRiskBandForCandidate(candidates[1]!), "high");
    assert.equal(candidateCapacityHomes(candidates[1]!), 120);

    const highFlood = filterCandidates(
      candidates,
      {
        text: "",
        neighborhood: "",
        scoreBand: "all",
        floodRisk: "high",
        capacityMin: "",
        capacityMax: "",
        shortlistedOnly: false,
        belowTargetOnly: false,
      },
      new Set()
    );
    assert.equal(highFlood.length, 1);
    assert.equal(highFlood[0]?.id, "b");

    const capacityRange = filterCandidates(
      candidates,
      {
        text: "",
        neighborhood: "",
        scoreBand: "all",
        floodRisk: "all",
        capacityMin: "50",
        capacityMax: "200",
        shortlistedOnly: false,
        belowTargetOnly: false,
      },
      new Set()
    );
    assert.equal(capacityRange.length, 1);
    assert.equal(capacityRange[0]?.id, "b");
  });
});
