import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyFloodWeightedWeights,
  mergeWeightDraftFromServer,
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

describe("mergeWeightDraftFromServer", () => {
  const serverWeights = [
    { id: "w1", key: "transit", label: "Transit", weight: 0.45 },
    { id: "w2", key: "housing", label: "Housing", weight: 0.35 },
    { id: "w3", key: "flood", label: "Flood", weight: 0.2 },
  ];
  const sync = { scenarioId: "s1", serverWeights };

  it("resets draft when switching scenario branches", () => {
    const edited = rebalanceWeights(serverWeights, 2, 50);
    const next = mergeWeightDraftFromServer(edited, "s2", serverWeights, sync);
    assert.equal(weightsEqual(next.draft, serverWeights), true);
    assert.equal(next.sync.scenarioId, "s2");
  });

  it("preserves unsaved edits across workspace refresh", () => {
    const edited = rebalanceWeights(serverWeights, 2, 50);
    const next = mergeWeightDraftFromServer(edited, "s1", serverWeights, sync);
    assert.equal(next.draft, edited);
    assert.deepEqual(next.sync, sync);
  });

  it("syncs draft after server weights change when not dirty", () => {
    const updatedServer = rebalanceWeights(serverWeights, 2, 40);
    const next = mergeWeightDraftFromServer(serverWeights, "s1", updatedServer, sync);
    assert.equal(weightsEqual(next.draft, updatedServer), true);
    assert.equal(weightsEqual(next.sync.serverWeights, updatedServer), true);
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
