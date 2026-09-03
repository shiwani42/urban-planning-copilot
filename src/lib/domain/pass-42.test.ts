import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assessExploreQuestion } from "./explore";
import { SERVER_WAKE_THRESHOLD_MS } from "../server-wake";

describe("pass 42 planner friction", () => {
  it("routes explore flood exposure questions", () => {
    const assessed = assessExploreQuestion("Which areas have the highest flood exposure?");
    assert.equal(assessed.supported, true);
    assert.equal(assessed.analysisType, "flood_exposure");
  });

  it("uses a 3s server wake threshold", () => {
    assert.equal(SERVER_WAKE_THRESHOLD_MS, 3000);
  });
});
