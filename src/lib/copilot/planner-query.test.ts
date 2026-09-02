import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routePlannerQuery, plannerSuggestions } from "./planner-query";
import { buildCopilotToolGroups, groupIdForTool } from "./tool-groups";

describe("planner query routing", () => {
  it("blocks project-scoped queries when no project is open", () => {
    const route = routePlannerQuery("run analysis", { hasProject: false });
    assert.equal(route.kind, "message");
    if (route.kind === "message") {
      assert.match(route.message, /open project/i);
    }
  });

  it("routes run analysis when a project is open", () => {
    const route = routePlannerQuery("please run analysis now", { hasProject: true });
    assert.equal(route.kind, "tool");
    if (route.kind === "tool") {
      assert.equal(route.tool, "run_analysis");
    }
  });

  it("home suggestions do not require a project", () => {
    const suggestions = plannerSuggestions(false);
    assert.ok(suggestions.some((s) => s.label.includes("new planning project")));
    assert.ok(!suggestions.some((s) => s.requiresProject));
  });

  it("workspace suggestions require a project", () => {
    const suggestions = plannerSuggestions(true);
    assert.ok(suggestions.every((s) => s.requiresProject));
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
