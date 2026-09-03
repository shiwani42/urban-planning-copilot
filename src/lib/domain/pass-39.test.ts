import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { exploreObjectiveTextForProject } from "./explore";
import { listRecentAnalyses } from "./services";
import {
  compareScenariosToolDetail,
  workspaceToolEventDetail,
} from "@/lib/workspace-sync";
import { resetStore, reloadStoreFromDisk } from "./store";
import * as services from "./services";

describe("pass 39 planner handoffs", () => {
  it("exploreObjectiveTextForProject embeds scratch summary", () => {
    const text = exploreObjectiveTextForProject({
      objective: "Where are transit gaps largest?",
      analysisType: "transit_gap",
      summary: "Top gaps cluster in the eastern corridor.",
      totalCandidates: 120,
    });
    assert.match(text, /Scratch findings/);
    assert.match(text, /Top gaps cluster/);
  });

  it("compareScenariosToolDetail opens Compare tab with scenario ids", () => {
    const detail = compareScenariosToolDetail(
      { scenarioIds: ["s1", "s2"], projectId: "p1" },
      { status: "ready", comparison: [] },
      "p1"
    );
    assert.equal(detail?.openTab, "compare");
    assert.deepEqual(detail?.compareScenarioIds, ["s1", "s2"]);
    assert.equal(detail?.comparePayload?.status, "ready");
  });

  it("workspaceToolEventDetail merges branch activation with mutation", () => {
    const detail = workspaceToolEventDetail(
      "create_scenario_branch",
      { projectId: "p1" },
      { activeScenarioId: "branch-1", note: "Created branch" },
      "p1"
    );
    assert.equal(detail?.tool, "create_scenario_branch");
    assert.equal(detail?.activeScenarioId, "branch-1");
    assert.match(detail?.resumeNote ?? "", /Created branch/);
  });

  it("listRecentAnalyses includes scenarioId for deep links", async () => {
    await resetStore();
    const ws = await services.createProject({
      name: "Recent analysis link test",
      objectiveText:
        "Identify areas capable of accommodating 500 additional homes near transit.",
    });
    await services.runAnalysis(ws.project.id, ws.project.activeScenarioId!);
    const store = await reloadStoreFromDisk();
    const rows = listRecentAnalyses(store, 5);
    assert.ok(rows.length >= 1);
    assert.equal(rows[0]?.scenarioId, ws.project.activeScenarioId);
    assert.equal(rows[0]?.projectId, ws.project.id);
  });
});
