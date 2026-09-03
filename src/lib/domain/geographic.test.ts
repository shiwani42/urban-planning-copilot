import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  featureIdsInExclusions,
  polygonFromRing,
  ringFromPolygon,
  uniqueGeographicLabel,
} from "./geographic";
import { runSpatialAnalysis } from "./spatial";
import { parseObjective } from "./objective";
import { generateSyntheticCity } from "./seed";
import type { GeographicSelection } from "./types";

describe("geographic helpers", () => {
  it("assigns unique exclusion labels", () => {
    const existing: GeographicSelection[] = [
      {
        id: "1",
        type: "exclusion",
        label: "Exclusion area",
        geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        createdBy: "human",
        createdAt: new Date().toISOString(),
      },
    ];
    assert.equal(uniqueGeographicLabel(existing, "exclusion"), "Exclusion area (2)");
    assert.equal(
      uniqueGeographicLabel(existing, "exclusion", "Riverside buffer"),
      "Riverside buffer"
    );
  });

  it("round-trips polygon rings without duplicate closing vertex", () => {
    const ring = [
      [0, 0],
      [1, 0],
      [1, 1],
    ] as [number, number][];
    const poly = polygonFromRing(ring);
    const back = ringFromPolygon(poly);
    assert.equal(back.length, 3);
    assert.deepEqual(back[0], [0, 0]);
  });

  it("identifies parcels inside exclusions", () => {
    const city = generateSyntheticCity(3);
    const parcel = city.featuresByDataset[city.datasets.find((d) => d.kind === "parcels")!.id]
      .features[0];
    const c = parcel.geometry as GeoJSON.Polygon;
    const coords = c.coordinates[0];
    const west = Math.min(...coords.map((p) => p[0]));
    const east = Math.max(...coords.map((p) => p[0]));
    const south = Math.min(...coords.map((p) => p[1]));
    const north = Math.max(...coords.map((p) => p[1]));
    const selections: GeographicSelection[] = [
      {
        id: "ex-1",
        type: "exclusion",
        label: "Test exclusion",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [west - 0.01, south - 0.01],
              [east + 0.01, south - 0.01],
              [east + 0.01, north + 0.01],
              [west - 0.01, north + 0.01],
              [west - 0.01, south - 0.01],
            ],
          ],
        },
        createdBy: "human",
        createdAt: new Date().toISOString(),
      },
    ];
    const ids = featureIdsInExclusions([parcel], selections);
    assert.ok(ids.has(String(parcel.properties?.id ?? parcel.id)));
  });
});

describe("geographic exclusion analysis", () => {
  it("removing an exclusion restores eligible candidates on recalc", () => {
    const city = generateSyntheticCity(7);
    const parsed = parseObjective(
      "Identify areas capable of accommodating 2000 additional homes within 800m of transit outside flood-risk areas."
    );
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) layers[d.kind] = city.featuresByDataset[d.id];
    const datasetIds = Object.fromEntries(city.datasets.map((d) => [d.kind, d.id]));
    const baseInput = {
      objective: parsed.objective,
      constraints: parsed.constraints,
      weights: parsed.weights,
      assumptions: parsed.assumptions,
      layers,
      datasetIds,
    };

    const without = runSpatialAnalysis({ ...baseInput, selections: [] });
    assert.ok(without.candidates.length > 0, "need baseline candidates");
    const target = without.candidates[0];
    const parcelFeature = layers.parcels!.features.find(
      (f) => String(f.properties?.id ?? f.id) === target.featureIds[0]
    );
    assert.ok(parcelFeature?.geometry?.type === "Polygon");
    const tc = parcelFeature.geometry as GeoJSON.Polygon;
    const tcoords = tc.coordinates[0];
    const twest = Math.min(...tcoords.map((p) => p[0]));
    const teast = Math.max(...tcoords.map((p) => p[0]));
    const tsouth = Math.min(...tcoords.map((p) => p[1]));
    const tnorth = Math.max(...tcoords.map((p) => p[1]));
    const exclusion: GeographicSelection = {
      id: "ex-test",
      type: "exclusion",
      label: "Planner buffer",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [twest - 0.01, tsouth - 0.01],
            [teast + 0.01, tsouth - 0.01],
            [teast + 0.01, tnorth + 0.01],
            [twest - 0.01, tnorth + 0.01],
            [twest - 0.01, tsouth - 0.01],
          ],
        ],
      },
      createdBy: "human",
      createdAt: new Date().toISOString(),
    };

    const withExclusion = runSpatialAnalysis({ ...baseInput, selections: [exclusion] });
    const restored = runSpatialAnalysis({ ...baseInput, selections: [] });

    assert.ok(withExclusion.candidates.length < without.candidates.length);
    assert.ok(!withExclusion.candidates.some((c) => c.id === target.id));
    assert.equal(restored.candidates.length, without.candidates.length);
  });
});
