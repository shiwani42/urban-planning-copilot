import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFloodCoverageDetail,
  candidateFloodIncompleteCaveat,
  featureIdsOutsideFloodCoverage,
  listFloodExcludedParcelLabels,
  parseFloodFunnel,
} from "./flood-coverage";
import type { AnalysisResult, Candidate, DatasetMeta } from "./types";

const floodDataset: DatasetMeta = {
  id: "ds-flood",
  kind: "flood",
  label: "Flood zones",
  description: "Test flood",
  source: "test",
  enabled: true,
  featureCount: 1,
  incompleteCoverage: true,
};

describe("flood-coverage", () => {
  it("parses funnel counts from step logs", () => {
    assert.deepEqual(parseFloodFunnel("Outside high-risk flood zones: 421 → 380"), {
      before: 421,
      after: 380,
    });
  });

  it("builds drill-down detail when coverage is incomplete and many parcels excluded", () => {
    const result = {
      candidates: [{ id: "c1", featureIds: ["p-ok"], label: "Ok parcel" }],
      stepLogs: [{ step: "constraint", detail: "Outside high-risk flood zones: 421 → 380" }],
      limitations: ["Flood dataset incomplete — verify site-specific risk"],
    } as unknown as AnalysisResult;

    const detail = buildFloodCoverageDetail({
      datasets: [floodDataset],
      result,
    });

    assert.ok(detail);
    assert.equal(detail.excludedCount, 41);
    assert.match(detail.incompleteReason, /partial/);
    assert.ok(detail.exclusionReasons.length >= 2);
  });

  it("lists sample excluded parcel labels from geometry", () => {
    const flood: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { risk: "high" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.42, 37.77],
                [-122.41, 37.77],
                [-122.41, 37.78],
                [-122.42, 37.78],
                [-122.42, 37.77],
              ],
            ],
          },
        },
      ],
    };

    const parcels: GeoJSON.Feature[] = [
      {
        type: "Feature",
        id: "p-risk",
        properties: { id: "p-risk", analysis_neighborhood: "Mission", blklot: "1/1" },
        geometry: { type: "Point", coordinates: [-122.415, 37.775] },
      },
      {
        type: "Feature",
        id: "p-safe",
        properties: { id: "p-safe" },
        geometry: { type: "Point", coordinates: [-122.5, 37.5] },
      },
    ];

    const labels = listFloodExcludedParcelLabels({
      parcels,
      flood,
      candidateFeatureIds: new Set(["p-safe"]),
    });

    assert.equal(labels.length, 1);
    assert.match(labels[0] ?? "", /Mission/);
  });

  it("flags high flood resilience when coverage is incomplete", () => {
    const candidate = {
      id: "c1",
      label: "Mission — Blk/Lot 1",
      featureIds: ["p1"],
      score: 80,
      rank: 1,
      metrics: [{ key: "flood_resilience", label: "Flood", value: 100, kind: "calculated" }],
      provenance: { limitations: [] },
    } as unknown as Candidate;

    const caveat = candidateFloodIncompleteCaveat(floodDataset, candidate);
    assert.ok(caveat);
    assert.match(caveat ?? "", /incomplete/i);

    const lowRisk = {
      ...candidate,
      metrics: [{ key: "flood_resilience", label: "Flood", value: 20, kind: "calculated" }],
    } as unknown as Candidate;
    assert.equal(candidateFloodIncompleteCaveat(floodDataset, lowRisk), null);
  });

  it("identifies parcels whose centroid sits outside the flood layer extent", () => {
    const parcels: GeoJSON.Feature[] = [
      {
        type: "Feature",
        id: "in",
        properties: { id: "in" },
        geometry: { type: "Point", coordinates: [-122.41, 37.76] },
      },
      {
        type: "Feature",
        id: "gap",
        properties: { id: "gap" },
        geometry: { type: "Point", coordinates: [-122.5, 37.8] },
      },
    ];
    const flood: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [-122.42, 37.75],
                [-122.4, 37.75],
                [-122.4, 37.77],
                [-122.42, 37.77],
                [-122.42, 37.75],
              ],
            ],
          },
        },
      ],
    };
    const gaps = featureIdsOutsideFloodCoverage(parcels, flood);
    assert.equal(gaps.has("gap"), true);
    assert.equal(gaps.has("in"), false);
  });
});
