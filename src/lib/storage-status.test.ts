import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  shouldShowStorageUnavailableBanner,
  type ClientStorageStatus,
} from "./storage-status";
import { describeWorkspaceOutcome } from "./copilot/workspace-outcome";

describe("storage-status banner gating", () => {
  it("hides banner when storage is healthy with write probe ok", () => {
    const storage: ClientStorageStatus = {
      status: "healthy",
      onPersistentMount: true,
      writeProbeOk: true,
    };
    assert.equal(shouldShowStorageUnavailableBanner(storage), false);
  });

  it("shows banner when write probe failed on persistent mount", () => {
    const storage: ClientStorageStatus = {
      status: "degraded",
      onPersistentMount: true,
      writeProbeOk: false,
      message: "Write probe failed: EACCES",
    };
    assert.equal(shouldShowStorageUnavailableBanner(storage), true);
  });

  it("does not show banner while loading", () => {
    assert.equal(shouldShowStorageUnavailableBanner({ status: "loading" }), false);
  });

  it("shows banner on health fetch error", () => {
    assert.equal(
      shouldShowStorageUnavailableBanner({
        status: "error",
        fetchError: "Network error",
      }),
      true
    );
  });
});

describe("workspace outcome sentence", () => {
  it("describes fresh analysis with top candidate", () => {
    const sentence = describeWorkspaceOutcome({
      isFreshResult: true,
      result: {
        id: "r1",
        scenarioId: "s1",
        status: "completed",
        stale: false,
        summary: "572 eligible parcels",
        candidates: [
          {
            id: "c1",
            label: "123 Main St",
            rank: 1,
            score: 88.2,
            featureIds: [],
            geometry: { type: "Point", coordinates: [0, 0] },
            centroid: [0, 0],
            metrics: [],
            provenance: {
              scoreBreakdown: {},
              calculations: [],
              datasets: [],
              assumptions: [],
              constraints: [],
              humanDecisions: [],
              limitations: [],
            },
            status: "eligible",
          },
        ],
        limitations: [],
        aggregateMetrics: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      scenarioName: "Baseline",
    });
    assert.match(sentence, /Analysis complete/);
    assert.match(sentence, /123 Main St/);
    assert.match(sentence, /88\.2/);
  });

  it("prefers latest successful copilot summary", () => {
    const sentence = describeWorkspaceOutcome({
      copilotActivity: [
        {
          id: "a1",
          tool: "run_analysis",
          status: "success",
          summary: "Analysis complete — 42 candidates ranked.",
          timestamp: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    assert.equal(sentence, "Analysis complete — 42 candidates ranked.");
  });
});
