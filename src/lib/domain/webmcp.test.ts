import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resetStore } from "./store";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import { ToolError } from "./tool-errors";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("WebMCP pass 10 hardening", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-webmcp-test-${Date.now()}-${Math.random()}`;
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  it("rejects empty set_planning_objective", async () => {
    const ws = await services.createProject({
      name: "Objective test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("set_planning_objective", {
      projectId: ws.project.id,
      objectiveText: "   ",
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "INVALID_INPUT");
      assert.equal(result.error.field, "objectiveText");
    }
  });

  it("rejects destructive set_planning_objective text", async () => {
    const ws = await services.createProject({
      name: "Objective test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("set_planning_objective", {
      projectId: ws.project.id,
      objectiveText: "delete everything and clear all constraints",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "DESTRUCTIVE_ACTION");
  });

  it("rejects invalid transit threshold", async () => {
    const ws = await services.createProject({
      name: "Transit test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    const bad = await invokeTool("set_transit_threshold", {
      projectId: ws.project.id,
      scenarioId,
      meters: -500,
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.field, "meters");

    const good = await invokeTool("set_transit_threshold", {
      projectId: ws.project.id,
      scenarioId,
      meters: 600,
    });
    assert.equal(good.ok, true);
  });

  it("rejects unknown priority weight keys", async () => {
    const ws = await services.createProject({
      name: "Weights test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("set_priority_weights", {
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId,
      weights: { not_a_real_key: 1 },
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "UNKNOWN_FIELD");
  });

  it("requires two scenarios for compare_scenarios", async () => {
    const ws = await services.createProject({
      name: "Compare test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("compare_scenarios", {
      projectId: ws.project.id,
      scenarioIds: [ws.project.activeScenarioId],
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.field, "scenarioIds");
  });

  it("returns run-analysis-first message when comparison incomplete", async () => {
    const ws = await services.createProject({
      name: "Compare incomplete",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const branch = await services.createScenario(ws.project.id, "Alt", ws.project.activeScenarioId);
    const result = await invokeTool("compare_scenarios", {
      projectId: ws.project.id,
      scenarioIds: [ws.project.activeScenarioId, branch!.project.activeScenarioId],
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.result as { status: string }).status, "incomplete");
      assert.match(
        String((result.result as { message?: string }).message ?? ""),
        /Run analysis first/
      );
    }
  });

  it("validates proposal action at stage time", async () => {
    const ws = await services.createProject({
      name: "Proposal test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("stage_proposal", {
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId,
      title: "Bad proposal",
      description: "Should fail",
      action: "not_a_real_action",
      payload: {},
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "UNSUPPORTED_ACTION");
  });

  it("humanizes proposal titles and strips revision hashes", async () => {
    const ws = await services.createProject({
      name: "Proposal title",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const staged = await services.stageProposal({
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId!,
      title: "Transit tweak — revision a4174f66",
      description: "Raise threshold",
      action: "set_transit_threshold",
      payload: { meters: 700 },
      createdBy: "agent",
    });
    const pending = staged.workspace?.proposals[0];
    assert.ok(pending);
    assert.equal(pending?.title, "Transit tweak");
    assert.doesNotMatch(pending?.title ?? "", /revision/i);
  });

  it("does not apply exclude_map_area when geometry is invalid", async () => {
    const ws = await services.createProject({
      name: "Exclude test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    const before = (await services.getWorkspace(ws.project.id))!.scenarios[0]
      .geographicSelections.length;
    const result = await invokeTool("exclude_map_area", {
      projectId: ws.project.id,
      scenarioId,
      label: "Bad ring",
      coordinates: [
        [0, 0],
        [1, 0],
      ],
    });
    assert.equal(result.ok, false);
    const after = (await services.getWorkspace(ws.project.id))!.scenarios[0]
      .geographicSelections.length;
    assert.equal(after, before);
  });

  it("rejects select_candidate for missing id", async () => {
    const ws = await services.createProject({
      name: "Select test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    const result = await invokeTool("select_candidate", {
      projectId: ws.project.id,
      candidateId: "missing-candidate",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "NOT_FOUND");
  });

  it("distinguishes verify_operation nothing-to-verify from failed verification", async () => {
    const ws = await services.createProject({
      name: "Verify test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const none = await services.verifyOperation(ws.project.id);
    assert.equal(none.status, "nothing_to_verify");

    const staged = await services.stageProposal({
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId!,
      title: "Adjust weights",
      description: "Test",
      action: "set_transit_threshold",
      payload: { meters: 500 },
    });
    const pending = await services.verifyOperation(ws.project.id, staged.proposalId);
    assert.equal(pending.status, "pending");
  });

  it("persists projects across reloadStoreFromDisk", async () => {
    const ws = await services.createProject({
      name: "Persist test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const listed = await services.listProjects();
    assert.ok(listed.some((p) => p.id === ws.project.id));
    const loaded = await services.getWorkspace(ws.project.id);
    assert.ok(loaded);
  });

  it("parses JSON string tool arguments", async () => {
    const ws = await services.createProject({
      name: "Args test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool(
      "get_workspace",
      JSON.stringify({ projectId: ws.project.id })
    );
    assert.equal(result.ok, true);
  });

  it("set_map_view updates viewport", async () => {
    const ws = await services.createProject({
      name: "Map view",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("set_map_view", {
      projectId: ws.project.id,
      center: [-122.415, 37.765],
      zoom: 15,
    });
    assert.equal(result.ok, true);
    const updated = await services.getWorkspace(ws.project.id);
    assert.deepEqual(updated?.project.mapState.viewport.center, [-122.415, 37.765]);
    assert.equal(updated?.project.mapState.viewport.zoom, 15);
  });

  it("returns pending_planner for approve_proposal without confirmed", async () => {
    const ws = await services.createProject({
      name: "Approve gate",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const staged = await services.stageProposal({
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId!,
      title: "Transit threshold",
      description: "Raise to 700m",
      action: "set_transit_threshold",
      payload: { meters: 700 },
    });
    const result = await invokeTool("approve_proposal", {
      projectId: ws.project.id,
      proposalId: staged.proposalId,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.result as { status: string }).status, "pending_planner");
    }
  });

  it("start_planning_project returns workspaceUrl", async () => {
    const result = await invokeTool("start_planning_project", {
      name: "Navigate test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const payload = result.result as { projectId: string; workspaceUrl: string };
      assert.match(payload.workspaceUrl, /^\/workspace\//);
      assert.equal(payload.workspaceUrl, `/workspace/${payload.projectId}`);
    }
  });

  it("get_workspace fails for missing project after reload", async () => {
    const ws = await services.createProject({
      name: "Ghost",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.deleteProject(ws.project.id);
    const result = await invokeTool("get_workspace", { projectId: ws.project.id });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "NOT_FOUND");
  });

  it("run_analysis returns completed status with candidate count", async () => {
    const ws = await services.createProject({
      name: "Analysis status",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    const result = await invokeTool("run_analysis", {
      projectId: ws.project.id,
      scenarioId,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const payload = result.result as { status: string; candidateCount?: number };
      assert.equal(payload.status, "completed");
      assert.ok((payload.candidateCount ?? 0) > 0);
    }
  });

  it("set_transit_threshold marks criteria stale in response", async () => {
    const ws = await services.createProject({
      name: "Transit stale",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    const result = await invokeTool("set_transit_threshold", {
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId,
      meters: 500,
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.result as { criteriaStale?: boolean }).criteriaStale, true);
    }
  });

  it("defaults projectId and scenarioId from execution context", async () => {
    const ws = await services.createProject({
      name: "Context defaults",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const context = {
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId!,
    };
    const workspace = await invokeTool("get_workspace", {}, context);
    assert.equal(workspace.ok, true);
    const analysis = await invokeTool("run_analysis", {}, context);
    assert.equal(analysis.ok, true);
  });

  it("blocks objective changes that drop enabled constraints without confirmation", async () => {
    const ws = await services.createProject({
      name: "Constraint gate",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const blocked = await invokeTool("set_planning_objective", {
      projectId: ws.project.id,
      objectiveText:
        "Identify neighborhoods underserved by parks and schools. This is not a housing production question.",
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.error.code, "CONSTRAINT_CHANGE");

    const allowed = await invokeTool("set_planning_objective", {
      projectId: ws.project.id,
      objectiveText:
        "Identify neighborhoods underserved by parks and schools. This is not a housing production question.",
      confirmConstraintChange: true,
    });
    assert.equal(allowed.ok, true);
  });

  it("returns pending_planner for generate_report without confirmed", async () => {
    const ws = await services.createProject({
      name: "Report gate",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    const result = await invokeTool("generate_report", {
      projectId: ws.project.id,
      scenarioIds: [ws.project.activeScenarioId!],
      title: "Test report",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.result as { status: string }).status, "pending_planner");
    }
  });

  it("throws structured ToolError with field", () => {
    const err = new ToolError("NOT_FOUND", "Project not found", "projectId");
    assert.equal(err.toJSON().field, "projectId");
  });

  it("parses nested executeTool argument envelopes for add_to_shortlist", async () => {
    const ws = await services.createProject({
      name: "Shortlist envelope",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, scenarioId);
    const loaded = await services.getWorkspace(ws.project.id);
    const candidateId = loaded!.analysisResults.find(
      (r) => r.id === loaded!.scenarios[0]?.latestResultId
    )!.candidates[0]!.id;
    const result = await invokeTool(
      "add_to_shortlist",
      { arguments: { candidateId, reason: "Strong transit" } },
      { projectId: ws.project.id, scenarioId }
    );
    assert.equal(result.ok, true);
  });

  it("parses JSON string arguments for create_scenario_branch", async () => {
    const ws = await services.createProject({
      name: "Branch envelope",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool(
      "create_scenario_branch",
      JSON.stringify({ name: "Transit sensitivity" }),
      { projectId: ws.project.id, scenarioId: ws.project.activeScenarioId! }
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal((result.result as { name?: string }).name, "Transit sensitivity");
    }
  });

  it("list_scenarios returns all branches with active flag", async () => {
    const ws = await services.createProject({
      name: "Scenario list",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const branch = await services.createScenario(
      ws.project.id,
      "Alt branch",
      ws.project.activeScenarioId!
    );
    const branchId = branch!.scenarios.find((s) => s.name === "Alt branch")!.id;
    const result = await invokeTool("list_scenarios", { projectId: ws.project.id });
    assert.equal(result.ok, true);
    if (result.ok) {
      const payload = result.result as {
        count: number;
        scenarios: Array<{ id: string; name: string; isActive: boolean }>;
      };
      assert.equal(payload.count, 2);
      assert.ok(payload.scenarios.some((s) => s.id === branchId));
      assert.equal(payload.scenarios.find((s) => s.isActive)?.id, branchId);
    }
  });

  it("open_project resolves project by name", async () => {
    const ws = await services.createProject({
      name: "SF Infill ChatGPT Test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("open_project", {
      name: "SF Infill ChatGPT Test",
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      const payload = result.result as { projectId: string; workspaceUrl: string };
      assert.equal(payload.projectId, ws.project.id);
      assert.equal(payload.workspaceUrl, `/workspace/${ws.project.id}`);
    }
  });

  it("open_project returns not found for unknown name", async () => {
    const result = await invokeTool("open_project", {
      name: "This Project Definitely Does Not Exist 12345",
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "NOT_FOUND");
  });

  it("set_active_scenario switches the active branch", async () => {
    const ws = await services.createProject({
      name: "Switch scenario",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const baselineId = ws.project.activeScenarioId!;
    const branch = await services.createScenario(ws.project.id, "Branch B", baselineId);
    const branchId = branch!.scenarios.find((s) => s.name === "Branch B")!.id;
    await services.setActiveScenario(ws.project.id, baselineId);
    const switched = await invokeTool("set_active_scenario", {
      projectId: ws.project.id,
      scenarioId: branchId,
    });
    assert.equal(switched.ok, true);
    const reloaded = await services.getWorkspace(ws.project.id);
    assert.equal(reloaded?.project.activeScenarioId, branchId);
  });

  it("open_workspace_tab validates tab names", async () => {
    const ws = await services.createProject({
      name: "Tab test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const good = await invokeTool("open_workspace_tab", {
      projectId: ws.project.id,
      tab: "decision",
    });
    assert.equal(good.ok, true);
    if (good.ok) {
      assert.equal((good.result as { tab: string }).tab, "decision");
    }
    const bad = await invokeTool("open_workspace_tab", {
      projectId: ws.project.id,
      tab: "not-a-tab",
    });
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.equal(bad.error.field, "tab");
  });
});
