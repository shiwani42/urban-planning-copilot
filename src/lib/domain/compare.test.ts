import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCompareTableRows,
  buildScenarioInputsDiff,
  comparisonResultsIdentical,
  enrichComparisonRows,
  housingTargetProgress,
  IDENTICAL_INPUTS_MESSAGE,
} from "./compare";
import { compareScenarioMetrics } from "./spatial";
import { generateSyntheticCity } from "./seed";
import { parseObjective } from "./objective";
import { runSpatialAnalysis } from "./spatial";
import { normalizeWeights } from "./objective";

describe("compare inputs diff", () => {
  const baseWeights = [
    { id: "a", key: "transit", label: "Transit", weight: 0.5 },
    { id: "b", key: "capacity", label: "Capacity", weight: 0.3 },
    { id: "c", key: "flood_resilience", label: "Flood resilience", weight: 0.2 },
  ];
  const baseConstraints = [
    {
      id: "c1",
      label: "Within 800m of transit",
      datasetKind: "transit" as const,
      operator: "within_distance" as const,
      value: 800,
      enabled: true,
      hard: true,
    },
  ];
  const baseAssumptions = [
    {
      id: "a1",
      label: "Housing target",
      value: 2000,
      unit: "homes",
      description: "Stated goal",
    },
  ];

  it("detects identical weights and constraints", () => {
    const diff = buildScenarioInputsDiff([
      {
        scenarioId: "s1",
        name: "Baseline",
        weights: baseWeights,
        constraints: baseConstraints,
        assumptions: baseAssumptions,
        objective: { intent: "housing_capacity", rawText: "2000 homes", targetValue: 2000 },
      },
      {
        scenarioId: "s2",
        name: "Branch",
        weights: baseWeights,
        constraints: baseConstraints,
        assumptions: baseAssumptions,
        objective: { intent: "housing_capacity", rawText: "2000 homes", targetValue: 2000 },
      },
    ]);
    assert.equal(diff.allIdentical, true);
    assert.equal(diff.identicalMessage, IDENTICAL_INPUTS_MESSAGE);
  });

  it("shows weight deltas when flood weight changes", () => {
    const diff = buildScenarioInputsDiff([
      {
        scenarioId: "s1",
        name: "Baseline",
        weights: baseWeights,
        constraints: baseConstraints,
        assumptions: baseAssumptions,
        objective: { intent: "housing_capacity", rawText: "2000 homes", targetValue: 2000 },
      },
      {
        scenarioId: "s2",
        name: "Flood-weighted",
        weights: [
          { id: "a", key: "transit", label: "Transit", weight: 0.4 },
          { id: "b", key: "capacity", label: "Capacity", weight: 0.25 },
          { id: "c", key: "flood_resilience", label: "Flood resilience", weight: 0.35 },
        ],
        constraints: baseConstraints,
        assumptions: baseAssumptions,
        objective: { intent: "housing_capacity", rawText: "2000 homes", targetValue: 2000 },
      },
    ]);
    assert.equal(diff.allIdentical, false);
    assert.equal(diff.identicalMessage, null);
    const weightsSection = diff.sections.find((s) => s.heading === "Weights");
    assert.ok(weightsSection);
    assert.equal(weightsSection!.identical, false);
    assert.ok(weightsSection!.lines.some((l) => /Flood resilience.*→/.test(l)));
  });
});

describe("housing target progress", () => {
  it("reports percent of goal and shortfall", () => {
    const p = housingTargetProgress({
      target: 2000,
      totalCapacity: 1098,
      meetsAloneCount: 0,
      shortlistCapacity: 800,
    });
    assert.ok(p);
    assert.equal(p!.percentOfTarget, 55);
    assert.equal(p!.gap, 902);
    assert.equal(p!.singleParcelMeets, false);
    assert.equal(p!.shortlistMeets, false);
    assert.match(p!.summary, /55%/);
  });

  it("notes when shortlist meets target", () => {
    const p = housingTargetProgress({
      target: 2000,
      totalCapacity: 1500,
      meetsAloneCount: 0,
      shortlistCapacity: 2100,
    });
    assert.ok(p);
    assert.equal(p!.shortlistMeets, true);
    assert.match(p!.summary, /Combined shortlist meets/);
  });
});

describe("compare table rows", () => {
  it("adds delta column for numeric metrics", () => {
    const rows = enrichComparisonRows([
      {
        scenarioId: "a",
        name: "A",
        housingTarget: 2000,
        intent: "housing_capacity",
        result: {
          candidates: [
            {
              id: "c1",
              label: "Site A",
              rank: 1,
              score: 80,
              metrics: [
                { key: "capacity", label: "Capacity", value: 500, kind: "calculated" },
                { key: "flood_resilience", label: "Flood", value: 70, kind: "calculated" },
              ],
              featureIds: ["f1"],
              status: "eligible",
              provenance: { calculations: [], limitations: [], datasets: [] },
            },
          ],
          aggregateMetrics: [
            { key: "eligible_count", label: "Eligible", value: 10, kind: "calculated" },
            { key: "total_capacity", label: "Capacity", value: 1000, kind: "calculated" },
            { key: "avg_transit_distance", label: "Transit", value: 400, kind: "calculated" },
            { key: "meets_target_count", label: "Meets", value: 0, kind: "calculated" },
          ],
          summary: "",
          limitations: [],
          stepLogs: [],
        },
      },
      {
        scenarioId: "b",
        name: "B",
        housingTarget: 2000,
        intent: "housing_capacity",
        result: {
          candidates: [
            {
              id: "c2",
              label: "Site B",
              rank: 1,
              score: 82,
              metrics: [
                { key: "capacity", label: "Capacity", value: 600, kind: "calculated" },
                { key: "flood_resilience", label: "Flood", value: 75, kind: "calculated" },
              ],
              featureIds: ["f2"],
              status: "eligible",
              provenance: { calculations: [], limitations: [], datasets: [] },
            },
          ],
          aggregateMetrics: [
            { key: "eligible_count", label: "Eligible", value: 12, kind: "calculated" },
            { key: "total_capacity", label: "Capacity", value: 1200, kind: "calculated" },
            { key: "avg_transit_distance", label: "Transit", value: 380, kind: "calculated" },
            { key: "meets_target_count", label: "Meets", value: 1, kind: "calculated" },
          ],
          summary: "",
          limitations: [],
          stepLogs: [],
        },
      },
    ]);

    const table = buildCompareTableRows(rows);
    const capacity = table.find((r) => r.key === "total_capacity");
    assert.ok(capacity);
    assert.equal(capacity!.delta, "+200");
    assert.equal(capacity!.applicable, true);

    const flood = table.find((r) => r.key === "avg_flood_resilience");
    assert.ok(flood);
    assert.equal(flood!.delta, "+5");
  });

  it("marks identical metrics across scenarios", () => {
    const city = generateSyntheticCity(7);
    const parsed = parseObjective(
      "Find 2000 homes within 800m of transit outside flood zones with residential zoning."
    );
    const layers: Record<string, GeoJSON.FeatureCollection> = {};
    for (const d of city.datasets) layers[d.kind] = city.featuresByDataset[d.id];
    const datasetIds = Object.fromEntries(city.datasets.map((d) => [d.kind, d.id]));
    const weights = normalizeWeights(parsed.weights);
    const input = {
      objective: parsed.objective,
      constraints: parsed.constraints,
      assumptions: parsed.assumptions,
      selections: [],
      layers,
      datasetIds,
      weights,
    };
    const out = runSpatialAnalysis(input);
    const rows = enrichComparisonRows([
      {
        scenarioId: "a",
        name: "Baseline",
        housingTarget: 2000,
        intent: "housing_capacity",
        weights,
        result: out,
      },
      {
        scenarioId: "b",
        name: "Clone",
        housingTarget: 2000,
        intent: "housing_capacity",
        weights,
        result: out,
      },
    ]);
    assert.equal(comparisonResultsIdentical(rows), true);
    const raw = compareScenarioMetrics([
      { scenarioId: "a", name: "A", housingTarget: 2000, intent: "housing_capacity", result: out },
      { scenarioId: "b", name: "B", housingTarget: 2000, intent: "housing_capacity", result: out },
    ]);
    assert.equal(raw[0].eligible_count, raw[1].eligible_count);
  });
});
