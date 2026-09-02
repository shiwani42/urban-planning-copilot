import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseObjective, normalizeWeights, buildAnalysisPlan } from "./objective";
import { runSpatialAnalysis } from "./spatial";
import { generateSyntheticCity } from "./seed";

describe("objective parsing", () => {
  it("extracts housing + transit + flood + zoning requirements", () => {
    const { objective, constraints } = parseObjective(
      "Find suitable areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones, while respecting residential zoning."
    );
    assert.equal(objective.intent, "housing_capacity");
    assert.equal(objective.targetValue, 2000);
    assert.ok(constraints.some((c) => c.operator === "within_distance"));
    assert.ok(constraints.some((c) => c.operator === "not_intersects"));
    assert.ok(constraints.some((c) => c.attribute === "zoning"));
  });

  it("detects emergency shelter intent", () => {
    const { objective } = parseObjective(
      "Identify three locations for emergency shelters that maximize population coverage and avoid flood-risk areas."
    );
    assert.equal(objective.intent, "emergency_shelter");
    assert.equal(objective.targetValue, 3);
  });

  it("detects school accessibility intent", () => {
    const { objective } = parseObjective(
      "Identify neighborhoods where a new school would most improve accessibility while avoiding areas already adequately served."
    );
    assert.equal(objective.intent, "school_accessibility");
  });

  it("detects transit gap intent", () => {
    const { objective } = parseObjective(
      "Find neighborhoods with the largest transit accessibility gaps."
    );
    assert.equal(objective.intent, "transit_gap");
  });
});

describe("weights", () => {
  it("normalizes to sum 1", () => {
    const w = normalizeWeights([
      { id: "a", key: "transit", label: "Transit", weight: 20 },
      { id: "b", key: "capacity", label: "Capacity", weight: 20 },
      { id: "c", key: "flood_resilience", label: "Flood", weight: 60 },
    ]);
    const sum = w.reduce((a, x) => a + x.weight, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9);
  });
});

describe("spatial analysis", () => {
  it("produces candidates from synthetic data", () => {
    const city = generateSyntheticCity(7);
    const parsed = parseObjective(
      "Identify areas capable of accommodating 2000 additional homes within 800m of transit outside flood-risk areas."
    );
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) {
      layers[d.kind] = city.featuresByDataset[d.id];
    }
    const out = runSpatialAnalysis({
      objective: parsed.objective,
      constraints: parsed.constraints,
      weights: parsed.weights,
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds: Object.fromEntries(city.datasets.map((d) => [d.kind, d.id])),
    });
    assert.ok(out.candidates.length > 0);
    assert.ok(out.stepLogs.length > 0);
    // excluded flood parcels should not appear
    for (const c of out.candidates) {
      const floodScore = c.metrics.find((m) => m.key === "flood_resilience")?.value;
      assert.notEqual(floodScore, 0);
    }
  });

  it("returns zero candidates for impossible constraints", () => {
    const city = generateSyntheticCity(7);
    const parsed = parseObjective(
      "Find 2000 homes within 1m of transit outside flood-risk areas with residential zoning."
    );
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) layers[d.kind] = city.featuresByDataset[d.id];
    // Force tiny transit threshold
    const constraints = parsed.constraints.map((c) =>
      c.operator === "within_distance" ? { ...c, value: 1 } : c
    );
    const out = runSpatialAnalysis({
      objective: parsed.objective,
      constraints,
      weights: parsed.weights,
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds: Object.fromEntries(city.datasets.map((d) => [d.kind, d.id])),
    });
    assert.equal(out.candidates.length, 0);
    assert.match(out.summary, /No feasible/i);
  });

  it("reducing transit threshold cannot increase eligible set", () => {
    const city = generateSyntheticCity(7);
    const parsed = parseObjective(
      "Find homes within 1200m of transit outside flood zones residential zoning."
    );
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) layers[d.kind] = city.featuresByDataset[d.id];
    const datasetIds = Object.fromEntries(city.datasets.map((d) => [d.kind, d.id]));

    const wide = runSpatialAnalysis({
      objective: parsed.objective,
      constraints: parsed.constraints.map((c) =>
        c.operator === "within_distance" ? { ...c, value: 1200 } : c
      ),
      weights: parsed.weights,
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds,
    });
    const narrow = runSpatialAnalysis({
      objective: parsed.objective,
      constraints: parsed.constraints.map((c) =>
        c.operator === "within_distance" ? { ...c, value: 400 } : c
      ),
      weights: parsed.weights,
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds,
    });
    assert.ok(narrow.candidates.length <= wide.candidates.length);
  });

  it("builds analysis plans without housing-only hardcoding", () => {
    const shelter = parseObjective(
      "Identify three emergency shelter locations maximizing population coverage avoiding flood-risk."
    );
    const plan = buildAnalysisPlan(shelter.objective, shelter.constraints, {
      parcels: "parcels",
      flood: "flood",
      population: "population",
    });
    assert.ok(plan.steps.some((s) => s.operation === "population_coverage"));
  });
});
