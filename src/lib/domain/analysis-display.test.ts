import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  aggregateMetricValue,
  analysisLimitations,
  candidateProvenance,
  limitationsSummary,
  normalizeAnalysisResult,
  normalizeCandidate,
} from "./analysis-display";
import type { AnalysisResult, Candidate } from "./types";

function minimalCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "c1",
    label: "Site A",
    featureIds: ["f1"],
    geometry: { type: "Point", coordinates: [0, 0] },
    centroid: [0, 0],
    score: 72.5,
    rank: 1,
    metrics: [{ key: "capacity", label: "Capacity", value: 400, kind: "calculated" }],
    provenance: undefined as unknown as Candidate["provenance"],
    status: "eligible",
    ...overrides,
  };
}

describe("analysis-display safe accessors", () => {
  it("treats missing result limitations as empty", () => {
    const result = {
      limitations: undefined,
    } as unknown as AnalysisResult;
    assert.deepEqual(analysisLimitations(result), []);
    assert.equal(limitationsSummary(result.limitations, { max: 2, fallback: "None" }), "None");
  });

  it("rebuilds provenance from result limitations when compact persist stripped candidate blobs", () => {
    const limitations = ["Incomplete flood mapping in eastern uplands"];
    const p = candidateProvenance(minimalCandidate(), limitations);
    assert.deepEqual(p.limitations, limitations);
    assert.deepEqual(p.datasets, []);
    assert.deepEqual(p.scoreBreakdown, {});
  });

  it("normalizes compact candidates without metrics or provenance", () => {
    const normalized = normalizeCandidate(
      minimalCandidate({ metrics: undefined as unknown as Candidate["metrics"] })
    );
    assert.deepEqual(normalized.metrics, []);
    assert.ok(normalized.provenance);
    assert.equal(normalized.score, 72.5);
  });

  it("normalizes analysis results missing aggregate metrics", () => {
    const result = normalizeAnalysisResult({
      id: "r1",
      jobId: "j1",
      scenarioId: "s1",
      status: "completed",
      createdAt: new Date().toISOString(),
      candidates: [minimalCandidate()],
      aggregateMetrics: undefined as unknown as AnalysisResult["aggregateMetrics"],
      summary: "ok",
      limitations: ["Dataset caveat"],
      stale: false,
      configHash: "abc",
    });
    assert.deepEqual(result.limitations, ["Dataset caveat"]);
    assert.deepEqual(result.aggregateMetrics, []);
    assert.equal(aggregateMetricValue(result, "total_capacity"), undefined);
    assert.equal(
      limitationsSummary(result.limitations, { fallback: "None recorded" }),
      "Dataset caveat"
    );
  });
});
