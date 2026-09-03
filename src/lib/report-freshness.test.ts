import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isReportBehindAnalysis, reportStaleLabel } from "./report-freshness";
import type { AnalysisResult, Report } from "@/lib/domain/types";

function sampleReport(createdAt: string, stale?: boolean): Report {
  return {
    id: "r1",
    projectId: "p1",
    scenarioIds: ["s1"],
    title: "Planning report",
    audience: "Planning team",
    createdAt,
    stale,
    sections: [{ heading: "Summary", kind: "calculated", body: "Body" }],
  };
}

function sampleResult(completedAt: string): AnalysisResult {
  return {
    id: "res-1",
    scenarioId: "s1",
    jobId: "job-1",
    status: "completed",
    createdAt: completedAt,
    completedAt,
    candidates: [
      {
        id: "c1",
        label: "Site A",
        featureIds: ["f1"],
        geometry: { type: "Point", coordinates: [0, 0] },
        centroid: [0, 0],
        score: 80,
        rank: 1,
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
    aggregateMetrics: [],
    summary: "Done",
    stepLogs: [],
    limitations: [],
    stale: false,
  };
}

describe("report freshness", () => {
  it("flags reports older than the latest analysis completion", () => {
    const report = sampleReport("2026-01-01T10:00:00.000Z");
    const result = sampleResult("2026-01-02T12:00:00.000Z");
    assert.equal(isReportBehindAnalysis(report, result), true);
    assert.match(reportStaleLabel(report, result) ?? "", /newer than this report/i);
  });

  it("treats explicit stale reports as stale even without result timing", () => {
    const report = sampleReport("2026-01-05T10:00:00.000Z", true);
    report.staleReason = "Planner decision recorded.";
    assert.equal(reportStaleLabel(report, undefined), "Planner decision recorded.");
  });

  it("does not flag fresh reports that postdate analysis", () => {
    const result = sampleResult("2026-01-01T10:00:00.000Z");
    const report = sampleReport("2026-01-02T12:00:00.000Z");
    assert.equal(isReportBehindAnalysis(report, result), false);
    assert.equal(reportStaleLabel(report, result), null);
  });
});
