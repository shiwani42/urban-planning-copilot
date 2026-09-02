import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { rebalanceWeights } from "./weights";

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
