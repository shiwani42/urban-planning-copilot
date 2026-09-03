import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFloodWeightedWeights,
  rebalanceWeights,
  weightsEqual,
} from "./weights";

describe("rebalanceWeights", () => {
  const weights = [
    { id: "w1", key: "transit", label: "Transit", weight: 0.45 },
    { id: "w2", key: "housing", label: "Housing", weight: 0.35 },
    { id: "w3", key: "flood", label: "Flood", weight: 0.2 },
  ];

  it("keeps the changed slider fixed and rebalances others", () => {
    const next = rebalanceWeights(weights, 2, 50);
    assert.equal(Math.round(next[2].weight * 100), 50);
    assert.equal(Math.round(next[0].weight * 100), 28);
    assert.equal(Math.round(next[1].weight * 100), 22);
    const sum = next.reduce((s, w) => s + w.weight, 0);
    assert.ok(Math.abs(sum - 1) < 0.001);
  });
});

describe("applyFloodWeightedWeights", () => {
  const housingWeights = [
    { id: "w1", key: "transit", label: "Transit accessibility", weight: 0.45 },
    { id: "w2", key: "capacity", label: "Housing capacity", weight: 0.35 },
    { id: "w3", key: "flood_resilience", label: "Flood resilience", weight: 0.2 },
  ];

  it("raises flood weight to 35% and rebalances siblings", () => {
    const next = applyFloodWeightedWeights(housingWeights);
    assert.equal(Math.round(next[2].weight * 100), 35);
    assert.notEqual(Math.round(next[0].weight * 100), 45);
    assert.notEqual(Math.round(next[1].weight * 100), 35);
    const sum = next.reduce((s, w) => s + w.weight, 0);
    assert.ok(Math.abs(sum - 1) < 0.001);
  });
});

describe("weightsEqual", () => {
  const base = [
    { id: "w1", key: "transit", label: "Transit", weight: 0.55 },
    { id: "w2", key: "housing", label: "Housing", weight: 0.45 },
  ];

  it("detects percent-level changes", () => {
    const changed = [
      { id: "w1", key: "transit", label: "Transit", weight: 0.54 },
      { id: "w2", key: "housing", label: "Housing", weight: 0.46 },
    ];
    assert.equal(weightsEqual(base, changed), false);
    assert.equal(weightsEqual(base, base.map((w) => ({ ...w }))), true);
  });
});
