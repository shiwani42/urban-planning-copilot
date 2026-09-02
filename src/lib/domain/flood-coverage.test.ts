import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildFloodCoverageDetail,
  listFloodExcludedParcelLabels,
  parseFloodFunnel,
} from "./flood-coverage";
import type { AnalysisResult, DatasetMeta } from "./types";

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
});
