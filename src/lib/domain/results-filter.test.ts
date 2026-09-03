import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  candidateNeighborhoods,
  filterCandidates,
  neighborhoodFromLabel,
  scoreBandFor,
} from "./results-filter";
import type { Candidate } from "./types";

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

describe("results-filter", () => {
  it("extracts neighborhood from candidate labels", () => {
    assert.equal(neighborhoodFromLabel("Mission — Blk/Lot 3595/006"), "Mission");
    assert.equal(neighborhoodFromLabel("Blk/Lot 1234/001"), "");
  });

  it("filters by neighborhood, score band, shortlist, and text", () => {
    const candidates = [
      mockCandidate({
        id: "a",
        label: "Mission — Blk/Lot 1",
        score: 80,
        rank: 1,
      }),
      mockCandidate({
        id: "b",
        label: "SoMa — Blk/Lot 2",
        score: 45,
        rank: 2,
      }),
      mockCandidate({
        id: "c",
        label: "Mission — Blk/Lot 3",
        score: 30,
        rank: 3,
      }),
    ];

    assert.deepEqual(candidateNeighborhoods(candidates), ["Mission", "SoMa"]);
    assert.equal(scoreBandFor(80), "high");
    assert.equal(scoreBandFor(45), "medium");
    assert.equal(scoreBandFor(20), "low");

    const filtered = filterCandidates(
      candidates,
      {
        text: "blk/lot 3",
        neighborhood: "Mission",
        scoreBand: "all",
        floodRisk: "all",
        capacityMin: "",
        capacityMax: "",
        shortlistedOnly: false,
        belowTargetOnly: false,
      },
      new Set()
    );
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.id, "c");

    const shortlisted = filterCandidates(
      candidates,
      {
        text: "",
        neighborhood: "",
        scoreBand: "high",
        floodRisk: "all",
        capacityMin: "",
        capacityMax: "",
        shortlistedOnly: true,
        belowTargetOnly: false,
      },
      new Set(["a"])
    );
    assert.equal(shortlisted.length, 1);
    assert.equal(shortlisted[0]?.id, "a");
  });

  it("filters candidates below housing target", () => {
    const candidates = [
      mockCandidate({
        id: "a",
        label: "Mission — Blk/Lot 1",
        score: 80,
        rank: 1,
        metrics: [{ key: "capacity", label: "Capacity", value: 500, unit: "homes" }],
      }),
      mockCandidate({
        id: "b",
        label: "SoMa — Blk/Lot 2",
        score: 70,
        rank: 2,
        metrics: [{ key: "capacity", label: "Capacity", value: 1200, unit: "homes" }],
      }),
    ];

    const belowTarget = filterCandidates(
      candidates,
      {
        text: "",
        neighborhood: "",
        scoreBand: "all",
        floodRisk: "all",
        capacityMin: "",
        capacityMax: "",
        shortlistedOnly: false,
        belowTargetOnly: true,
      },
      new Set(),
      { housingTarget: 1000 }
    );
    assert.equal(belowTarget.length, 1);
    assert.equal(belowTarget[0]?.id, "a");
  });
});
