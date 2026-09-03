import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routePlannerQuery } from "@/lib/copilot/planner-query";
import {
  mutationDetailFromToolResult,
  pendingPlannerNavigationDetail,
} from "@/lib/workspace-sync";
import { workspaceTabHref } from "@/lib/workspace-tabs";
import * as services from "./services";
import { resetStore } from "./store";

const workspaceCtx = {
  hasProject: true,
  scenarioCount: 1,
  scenarioIds: ["sc-a"],
  topCandidateId: "cand-1",
};

describe("pass 45 decision and report workspace pages", () => {
  it("routes open decision to the decision path tab", () => {
    const route = routePlannerQuery("open decision review", workspaceCtx);
    assert.equal(route.kind, "workspace_tab");
    if (route.kind === "workspace_tab") {
      assert.equal(route.tab, "decision");
    }
  });

  it("routes approve to decision tab with approve_scenario tool", () => {
    const route = routePlannerQuery("approve this scenario", workspaceCtx);
    assert.equal(route.kind, "workspace_tab");
    if (route.kind === "workspace_tab") {
      assert.equal(route.tab, "decision");
      assert.equal(route.tool, "approve_scenario");
    }
  });

  it("routes generate report to report tab with generate_report tool", () => {
    const route = routePlannerQuery("generate report for this branch", workspaceCtx);
    assert.equal(route.kind, "workspace_tab");
    if (route.kind === "workspace_tab") {
      assert.equal(route.tab, "report");
      assert.equal(route.tool, "generate_report");
    }
  });

  it("opens report tab after generate_report mutation", () => {
    const detail = mutationDetailFromToolResult(
      "generate_report",
      { projectId: "p1" },
      { reportId: "rep-1" },
      "p1"
    );
    assert.equal(detail?.openTab, "report");
    assert.equal(detail?.reportId, "rep-1");
  });

  it("opens decision tab for pending approve_scenario", () => {
    const detail = pendingPlannerNavigationDetail("approve_scenario", "p1");
    assert.equal(detail?.openTab, "decision");
  });

  it("exposes first-class decision and report path URLs", () => {
    assert.equal(workspaceTabHref("proj-1", "decision"), "/workspace/proj-1/decision");
    assert.equal(workspaceTabHref("proj-1", "report"), "/workspace/proj-1/report");
  });

  it("marks reports stale after analysis recalculates", async () => {
    await resetStore();
    const ws = await services.createProject({
      name: "Report stale on analysis",
      objectiveText:
        "Identify areas capable of accommodating 500 additional homes near transit.",
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, scenarioId);
    const generated = await services.generateReport(ws.project.id, [scenarioId]);
    assert.ok(generated.report);
    assert.notEqual(generated.report?.stale, true);

    await services.runAnalysis(ws.project.id, scenarioId);
    const after = await services.getWorkspace(ws.project.id);
    const report = after!.reports.find((r) => r.id === generated.reportId);
    assert.equal(report?.stale, true);
    assert.match(report?.staleReason ?? "", /recalculated/i);
  });
});
