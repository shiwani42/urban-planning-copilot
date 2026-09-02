import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseObjective, normalizeWeights, buildAnalysisPlan, assessObjectiveQuality } from "./objective";
import { runSpatialAnalysis, compareScenarioMetrics, buildComparisonInsights } from "./spatial";
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
    assert.ok(constraints.some((c) => c.attribute === "land_use" || c.attribute === "zoning"));
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

  it("flags uninterpretable objectives", () => {
    const quality = assessObjectiveQuality("hello");
    assert.equal(quality.interpretable, false);
    assert.ok(quality.warning);
    const parsed = parseObjective("hello");
    assert.ok(parsed.objective.confidence < 0.3);
    assert.ok(parsed.objective.qualityWarning);
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

  it("adds per-candidate housing target gap for housing objectives", () => {
    const city = generateSyntheticCity(7);
    const parsed = parseObjective(
      "Identify areas capable of accommodating 2000 additional homes within 800m of transit outside flood-risk areas."
    );
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) layers[d.kind] = city.featuresByDataset[d.id];
    const out = runSpatialAnalysis({
      objective: parsed.objective,
      constraints: parsed.constraints,
      weights: parsed.weights,
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds: Object.fromEntries(city.datasets.map((d) => [d.kind, d.id])),
      externalLimitations: ["Flood risk zones (Synthetic): Eastern uplands have incomplete flood mapping"],
    });
    const top = out.candidates[0];
    assert.ok(top.metrics.some((m) => m.key === "housing_target_gap"));
    assert.ok(top.provenance.limitations.some((l) => l.includes("incomplete flood")));
    assert.ok(out.aggregateMetrics.some((m) => m.key === "meets_target_count"));
  });

  it("reweights change ranking more than inflating absolute scores", () => {
    const city = generateSyntheticCity(7);
    const parsed = parseObjective(
      "Find 2000 homes within 800m of transit outside flood zones with residential zoning."
    );
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) layers[d.kind] = city.featuresByDataset[d.id];
    const datasetIds = Object.fromEntries(city.datasets.map((d) => [d.kind, d.id]));
    const baseInput = {
      objective: parsed.objective,
      constraints: parsed.constraints,
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds,
    };
    const transitHeavy = runSpatialAnalysis({
      ...baseInput,
      weights: normalizeWeights([
        { id: "a", key: "transit", label: "Transit", weight: 0.8 },
        { id: "b", key: "capacity", label: "Capacity", weight: 0.15 },
        { id: "c", key: "flood_resilience", label: "Flood", weight: 0.05 },
      ]),
    });
    const capacityHeavy = runSpatialAnalysis({
      ...baseInput,
      weights: normalizeWeights([
        { id: "a", key: "transit", label: "Transit", weight: 0.1 },
        { id: "b", key: "capacity", label: "Capacity", weight: 0.75 },
        { id: "c", key: "flood_resilience", label: "Flood", weight: 0.15 },
      ]),
    });
    assert.ok(transitHeavy.candidates.length > 0);
    assert.ok(capacityHeavy.candidates.length > 0);
    const orderA = transitHeavy.candidates.slice(0, 5).map((c) => c.id).join(",");
    const orderB = capacityHeavy.candidates.slice(0, 5).map((c) => c.id).join(",");
    assert.notEqual(orderA, orderB, "expected top-5 ordering to shift with weights");
    const rows = compareScenarioMetrics([
      {
        scenarioId: "a",
        name: "Transit-first",
        housingTarget: 2000,
        weights: transitHeavy.candidates.length ? parsed.weights : [],
        result: transitHeavy,
      },
      {
        scenarioId: "b",
        name: "Capacity-first",
        housingTarget: 2000,
        weights: capacityHeavy.candidates.length ? parsed.weights : [],
        result: capacityHeavy,
      },
    ]);
    assert.notEqual(rows[0].top_3, rows[1].top_3);
    const insights = buildComparisonInsights([
      {
        scenarioId: "a",
        name: "Transit-first",
        housingTarget: 2000,
        result: transitHeavy,
      },
      {
        scenarioId: "b",
        name: "Capacity-first",
        housingTarget: 2000,
        result: capacityHeavy,
      },
    ]);
    assert.ok(insights.some((i) => i.heading === "Top recommendation"));
  });
});
