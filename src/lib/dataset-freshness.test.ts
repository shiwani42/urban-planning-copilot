import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DatasetMeta } from "./domain/types";
import {
  datasetFreshnessFlags,
  isSparseDatasetCoverage,
  isVintageStale,
  vintageAgeYears,
} from "./dataset-freshness";

function floodDataset(): DatasetMeta {
  return {
    id: "ds-flood",
    name: "SFPUC flood",
    kind: "flood",
    source: "test",
    version: "2022-07-01",
    updatedAt: "2026-01-01T00:00:00.000Z",
    dataVintage: "2022-07-01",
    synthetic: false,
    coverage: "Clipped AOI",
    limitations: [],
    featureCount: 1,
    enabled: true,
    incompleteCoverage: true,
    attributes: [],
  };
}

function parcelDataset(): DatasetMeta {
  return {
    id: "ds-parcels",
    name: "Parcels",
    kind: "parcels",
    source: "test",
    version: "2026-04-23",
    updatedAt: "2026-01-01T00:00:00.000Z",
    dataVintage: "2026-04-23",
    synthetic: false,
    coverage: "AOI",
    limitations: [],
    featureCount: 2365,
    enabled: true,
    attributes: [],
  };
}

describe("dataset freshness", () => {
  it("marks 2022 flood vintage as stale in 2026", () => {
    const asOf = new Date("2026-09-03T00:00:00.000Z");
    assert.ok(isVintageStale("2022-07-01", 2, asOf));
    assert.ok(vintageAgeYears("2022-07-01", asOf)! >= 4);
  });

  it("does not mark 2026 parcel vintage as stale", () => {
    const asOf = new Date("2026-09-03T00:00:00.000Z");
    assert.equal(isVintageStale("2026-04-23", 2, asOf), false);
  });

  it("flags flood layer as sparse vs parcel reference count", () => {
    const flood = floodDataset();
    const parcels = parcelDataset();
    assert.equal(isSparseDatasetCoverage(flood, parcels.featureCount), true);
    const flags = datasetFreshnessFlags(flood, {
      referenceFeatureCount: parcels.featureCount,
      asOf: new Date("2026-09-03T00:00:00.000Z"),
    });
    assert.equal(flags.sparseCoverage, true);
    assert.equal(flags.vintageStale, true);
    assert.match(flags.cautionSummary ?? "", /2022-07-01/);
    assert.match(flags.cautionSummary ?? "", /1 feature/);
  });

  it("treats fresh parcels as complete coverage", () => {
    const parcels = parcelDataset();
    const flags = datasetFreshnessFlags(parcels, {
      referenceFeatureCount: parcels.featureCount,
      asOf: new Date("2026-09-03T00:00:00.000Z"),
    });
    assert.equal(flags.sparseCoverage, false);
    assert.equal(flags.vintageStale, false);
    assert.equal(flags.cautionSummary, null);
  });
});
