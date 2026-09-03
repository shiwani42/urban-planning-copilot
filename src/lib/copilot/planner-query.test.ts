import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  routePlannerQuery,
  plannerSuggestions,
  extractBranchName,
  summarizeToolResult,
} from "./planner-query";
import { buildCopilotToolGroups, groupIdForTool } from "./tool-groups";

const workspaceCtx = {
  hasProject: true,
  scenarioCount: 1,
  scenarioIds: ["sc-a"],
  topCandidateId: "cand-1",
  topCandidateLabel: "Mission — Blk/Lot 3595/006",
};

const multiScenarioCtx = {
  ...workspaceCtx,
  scenarioCount: 2,
  analyzedScenarioCount: 2,
  scenarioIds: ["sc-a", "sc-b"],
  analyzedScenarioIds: ["sc-a", "sc-b"],
};

const oneAnalyzedScenarioCtx = {
  ...workspaceCtx,
  scenarioCount: 2,
  analyzedScenarioCount: 1,
  scenarioIds: ["sc-a", "sc-b"],
  analyzedScenarioIds: ["sc-a"],
  unanalyzedScenarioName: "Flood-weighted branch",
};

describe("planner query routing", () => {
  it("blocks project-scoped queries when no project is open", () => {
    const route = routePlannerQuery("run analysis", { hasProject: false });
    assert.equal(route.kind, "message");
    if (route.kind === "message") {
      assert.match(route.message, /open project/i);
    }
  });

  it("empty command uses planner language", () => {
    const route = routePlannerQuery("   ", workspaceCtx);
    assert.equal(route.kind, "message");
    if (route.kind === "message") {
      assert.match(route.message, /Command this study/);
      assert.doesNotMatch(route.message, /^Ask /);
    }
  });

  it("routes run analysis when a project is open", () => {
    const route = routePlannerQuery("please run analysis now", workspaceCtx);
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "run_analysis");
    }
  });

  it("pins top site to shortlist instead of listing", () => {
    const route = routePlannerQuery("pin the top site", workspaceCtx);
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "add_to_shortlist");
      assert.equal(route.args.candidateId, "cand-1");
    }
  });

  it("shortlist top site routes to add_to_shortlist", () => {
    const route = routePlannerQuery("shortlist top site", workspaceCtx);
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "add_to_shortlist");
    }
  });

  it("explicit list shortlist still reads the shortlist", () => {
    const route = routePlannerQuery("show shortlist count", workspaceCtx);
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "list_shortlist");
    }
  });

  it("duplicate scenario creates a branch with a name", () => {
    const route = routePlannerQuery("duplicate this scenario", workspaceCtx);
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "create_scenario_branch");
      assert.ok(typeof route.args.name === "string" && route.args.name.length >= 2);
    }
  });

  it("flood-weighted branch uses a descriptive name", () => {
    const route = routePlannerQuery("create a flood-weighted branch", workspaceCtx);
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "create_scenario_branch");
      assert.equal(route.args.name, "Flood-weighted branch");
    }
  });

  it("compare with one analyzed scenario explains run-analysis recovery", () => {
    const route = routePlannerQuery("compare scenarios", oneAnalyzedScenarioCtx);
    assert.equal(route.kind, "message");
    if (route.kind === "message") {
      assert.match(route.message, /two analyzed scenarios/i);
      assert.match(route.message, /Flood-weighted branch/i);
    }
  });

  it("compare with one scenario explains the requirement", () => {
    const route = routePlannerQuery("compare scenarios", workspaceCtx);
    assert.equal(route.kind, "message");
    if (route.kind === "message") {
      assert.match(route.message, /two analyzed scenarios/i);
      assert.match(route.message, /flood-weighted branch/i);
    }
  });

  it("compare with two scenarios calls compare_scenarios", () => {
    const route = routePlannerQuery("compare scenarios", multiScenarioCtx);
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "compare_scenarios");
      assert.deepEqual(route.args.scenarioIds, ["sc-a", "sc-b"]);
    }
  });

  it("opens decision tab for natural-language review", () => {
    const route = routePlannerQuery("open decision", workspaceCtx);
    assert.equal(route.kind, "workspace_tab");
    if (route.kind === "workspace_tab") {
      assert.equal(route.tab, "decision");
    }
  });

  it("routes approve to decision tab with approve_scenario tool", () => {
    const route = routePlannerQuery("approve scenario", workspaceCtx);
    assert.equal(route.kind, "workspace_tab");
    if (route.kind === "workspace_tab") {
      assert.equal(route.tab, "decision");
      assert.equal(route.tool, "approve_scenario");
    }
  });

  it("routes generate report to report tab with generate_report tool", () => {
    const route = routePlannerQuery("generate report", workspaceCtx);
    assert.equal(route.kind, "workspace_tab");
    if (route.kind === "workspace_tab") {
      assert.equal(route.tab, "report");
      assert.equal(route.tool, "generate_report");
    }
  });

  it("exclude area without map selection asks to draw first", () => {
    const route = routePlannerQuery("exclude this area from analysis", workspaceCtx);
    assert.equal(route.kind, "message");
    if (route.kind === "message") {
      assert.match(route.message, /draw an exclusion on the map/i);
      assert.doesNotMatch(route.message, /shortlist/i);
    }
  });

  it("exclude area with drawn polygon calls exclude_map_area", () => {
    const route = routePlannerQuery("exclude this area", {
      ...workspaceCtx,
      exclusion: {
        exclusionRing: [
          [-122.42, 37.76],
          [-122.41, 37.76],
          [-122.41, 37.77],
        ],
        exclusionLabel: "Riverside buffer",
      },
    });
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "exclude_map_area");
      assert.equal(route.args.label, "Riverside buffer");
      assert.ok(Array.isArray(route.args.coordinates));
    }
  });

  it("exclude selected parcel calls exclude_features", () => {
    const route = routePlannerQuery("add exclusion for this parcel", {
      ...workspaceCtx,
      exclusion: {
        selectedParcel: {
          featureIds: ["parcel-1"],
          label: "Mission — Blk/Lot 3595/006",
        },
      },
    });
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "exclude_features");
      assert.deepEqual(route.args.featureIds, ["parcel-1"]);
    }
  });

  it("home suggestions do not require a project", () => {
    const suggestions = plannerSuggestions({ hasProject: false });
    assert.ok(suggestions.some((s) => s.label.includes("new planning project")));
    assert.ok(!suggestions.some((s) => s.requiresProject));
  });

  it("workspace suggestions require a project", () => {
    const suggestions = plannerSuggestions(workspaceCtx);
    assert.ok(suggestions.every((s) => s.requiresProject));
  });

  it("offers run-analysis chip when a branch lacks analysis", () => {
    const suggestions = plannerSuggestions(oneAnalyzedScenarioCtx);
    assert.ok(suggestions.some((s) => s.label.includes("Run analysis on Flood-weighted branch")));
    assert.ok(!suggestions.some((s) => s.tool === "compare_scenarios"));
  });

  it("offers flood branch instead of compare with one scenario", () => {
    const suggestions = plannerSuggestions(workspaceCtx);
    assert.ok(suggestions.some((s) => s.label.includes("Flood-weighted branch")));
    assert.ok(!suggestions.some((s) => s.tool === "compare_scenarios"));
  });

  it("offers compare when two analyzed scenarios exist", () => {
    const suggestions = plannerSuggestions(multiScenarioCtx);
    assert.ok(suggestions.some((s) => s.tool === "compare_scenarios"));
  });
});

describe("branch name extraction", () => {
  it("extracts flood-weighted branch name", () => {
    assert.equal(extractBranchName("make a flood weighted branch"), "Flood-weighted branch");
  });
});

describe("copilot summaries", () => {
  it("formats pin activity in human sentences", () => {
    const summary = summarizeToolResult(
      "add_to_shortlist",
      { shortlistCount: 1, note: "Pinned to shortlist (1 site)" },
      { candidateLabel: "Mission — Blk/Lot 3595/006" }
    );
    assert.match(summary, /Pinned Mission — Blk\/Lot 3595\/006 to the shortlist/);
  });

  it("uses list_shortlist message instead of JSON", () => {
    const summary = summarizeToolResult("list_shortlist", {
      count: 0,
      message: "Shortlist is empty (0 sites).",
    });
    assert.equal(summary, "Shortlist is empty (0 sites).");
  });
});

describe("copilot tool groups", () => {
  it("groups map tools together", () => {
    assert.equal(groupIdForTool("exclude_map_area"), "map");
    assert.equal(groupIdForTool("run_analysis"), "analysis");
    assert.equal(groupIdForTool("generate_report"), "reports");
  });

  it("omits project tools from workspace catalog", () => {
    const groups = buildCopilotToolGroups({ includeProjects: false });
    assert.ok(!groups.some((g) => g.id === "projects"));
  });

  it("includes project tools on home", () => {
    const groups = buildCopilotToolGroups({ includeProjects: true });
    assert.ok(groups.some((g) => g.id === "projects"));
  });
});
