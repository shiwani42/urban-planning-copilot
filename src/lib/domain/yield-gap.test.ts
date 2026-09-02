import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeYieldGap } from "./yield-gap";
import type { Candidate } from "./types";

function mockCandidate(rank: number, capacity: number, label: string): Candidate {
  return {
    id: `c-${rank}`,
    label,
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

describe("yield-gap", () => {
  it("warns when top site and shortlist cannot meet housing target", () => {
    const candidates = [
      mockCandidate(1, 13, "Mission — Blk/Lot 1"),
      mockCandidate(2, 10, "Mission — Blk/Lot 2"),
      mockCandidate(3, 8, "SoMa — Blk/Lot 3"),
    ];

    const gap = computeYieldGap({
      target: 600,
      candidates,
      shortlist: [
        {
          candidateId: "c-1",
          featureIds: ["f-1"],
          reason: "Pinned",
          pinnedAt: "2026-01-01T00:00:00.000Z",
          candidate: candidates[0],
        },
      ],
      topN: 3,
    });

    assert.ok(gap);
    assert.equal(gap.needsWarning, true);
    assert.equal(gap.topCandidateCapacity, 13);
    assert.equal(gap.topNCapacity, 31);
    assert.equal(gap.shortlistCapacity, 13);
    assert.match(gap.detail, /No single parcel meets/);
    assert.match(gap.detail, /Shortlist 1 site/);
  });

  it("returns null when target is missing or no candidates", () => {
    assert.equal(
      computeYieldGap({ target: 0, candidates: [], shortlist: [] }),
      null
    );
  });
});
