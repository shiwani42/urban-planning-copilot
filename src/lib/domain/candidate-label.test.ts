import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { candidateLabelFromFeature } from "./candidate-label";

describe("candidateLabelFromFeature", () => {
  it("prefers neighborhood and blklot over raw parcel id", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: {
        id: "3595006",
        analysis_neighborhood: "Mission",
        blklot: "3595/006",
      },
      geometry: { type: "Point", coordinates: [0, 0] },
    };
    assert.equal(candidateLabelFromFeature(feature, "3595006"), "Mission — Blk/Lot 3595/006");
  });

  it("falls back to parcel id when no location attributes", () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      properties: { id: "3595006" },
      geometry: { type: "Point", coordinates: [0, 0] },
    };
    assert.equal(candidateLabelFromFeature(feature, "3595006"), "Parcel 3595006");
  });
});
