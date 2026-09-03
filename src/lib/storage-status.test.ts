import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  projectsPersistReliably,
  shouldShowEphemeralStorageBanner,
  shouldShowStorageUnavailableBanner,
  storageReliabilityIssue,
  EPHEMERAL_STORAGE_BANNER_MESSAGE,
  type ClientStorageStatus,
} from "./storage-status";
import { containsForbiddenPlannerCopy } from "./planner-copy";
import { describeWorkspaceOutcome } from "./copilot/workspace-outcome";

describe("storage-status banner gating", () => {
  it("ephemeral banner copy is planner-facing", () => {
    assert.equal(containsForbiddenPlannerCopy(EPHEMERAL_STORAGE_BANNER_MESSAGE), false);
  });

  it("hides banner when postgres storage is healthy with write probe ok", () => {
    const storage: ClientStorageStatus = {
      status: "healthy",
      onPersistentMount: true,
      writeProbeOk: true,
      persistBackend: "postgres",
      postgresOk: true,
      storeExists: true,
    };
    assert.equal(shouldShowStorageUnavailableBanner(storage), false);
    assert.equal(shouldShowEphemeralStorageBanner(storage), false);
    assert.equal(projectsPersistReliably(storage), true);
  });

  it("shows ephemeral banner when file backend is active", () => {
    const storage: ClientStorageStatus = {
      status: "healthy",
      writeProbeOk: true,
      persistBackend: "file",
      storeExists: true,
    };
    assert.equal(shouldShowStorageUnavailableBanner(storage), false);
    assert.equal(shouldShowEphemeralStorageBanner(storage), true);
    assert.equal(projectsPersistReliably(storage), false);
    assert.equal(storageReliabilityIssue(storage), null);
  });

  it("shows banner when write probe failed on persistent mount", () => {
    const storage: ClientStorageStatus = {
      status: "degraded",
      onPersistentMount: true,
      writeProbeOk: false,
      persistBackend: "postgres",
      postgresOk: false,
      message: "Write probe failed: EACCES",
    };
    assert.equal(shouldShowStorageUnavailableBanner(storage), true);
    assert.equal(shouldShowEphemeralStorageBanner(storage), false);
  });

  it("does not show banner while loading", () => {
    assert.equal(shouldShowStorageUnavailableBanner({ status: "loading" }), false);
    assert.equal(shouldShowEphemeralStorageBanner({ status: "loading" }), false);
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

  it("hides ephemeral banner when postgres is active", () => {
    assert.equal(
      shouldShowEphemeralStorageBanner({
        status: "healthy",
        persistBackend: "postgres",
        postgresOk: true,
      }),
      false
    );
  });

  it("shows ephemeral banner for file backend", () => {
    assert.equal(
      shouldShowEphemeralStorageBanner({
        status: "healthy",
        persistBackend: "file",
        writeProbeOk: true,
      }),
      true
    );
  });

  it("shows unavailable banner when postgres probe fails", () => {
    const storage: ClientStorageStatus = {
      status: "degraded",
      persistBackend: "postgres",
      postgresOk: false,
      writeProbeOk: false,
      message: "Postgres write probe failed",
    };
    assert.equal(shouldShowEphemeralStorageBanner(storage), false);
    assert.equal(shouldShowStorageUnavailableBanner(storage), true);
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

  it("avoids duplicating empty-analysis status copy", () => {
    const sentence = describeWorkspaceOutcome({});
    assert.doesNotMatch(sentence, /No results yet/i);
    assert.doesNotMatch(sentence, /No analysis yet/i);
  });
});
