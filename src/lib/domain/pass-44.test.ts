import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  parseCompareScenarioIds,
  parseWorkspacePathTab,
  resolveWorkspaceTabFromParams,
  serializeCompareScenarioIds,
  workspaceTabUrl,
  WORKSPACE_TAB_KEYBOARD_SHORTCUTS,
} from "../workspace-tabs";
import {
  compareScenariosToolDetail,
  mutationDetailFromToolResult,
} from "@/lib/workspace-sync";
import { PLANNING_TOOL_ALIASES } from "@/lib/webmcp/tool-aliases";
import * as services from "./services";
import { resetStore } from "./store";
import { invokeTool } from "./webmcp";

describe("pass 44 path tab regressions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "upc-pass44-"));
    process.env.DATA_DIR = tmpDir;
    await resetStore();
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("builds compare URLs with scenario ids in the query string", () => {
    assert.equal(
      workspaceTabUrl("proj-1", "compare", {
        compareScenarioIds: ["s1", "s2"],
      }),
      "/workspace/proj-1/compare?compareScenarioIds=s1%2Cs2"
    );
  });

  it("preserves scenarioId deep links alongside path tabs", () => {
    assert.equal(
      workspaceTabUrl("proj-1", "workspace", { scenarioId: "branch-2" }),
      "/workspace/proj-1?scenarioId=branch-2"
    );
    assert.equal(
      workspaceTabUrl("proj-1", "results", { scenarioId: "branch-2" }),
      "/workspace/proj-1/results?scenarioId=branch-2"
    );
  });

  it("parses compare scenario ids and workspace path tabs", () => {
    assert.deepEqual(parseCompareScenarioIds("a,b , c"), ["a", "b", "c"]);
    assert.equal(serializeCompareScenarioIds(["a", "b"]), "a,b");
    assert.equal(parseWorkspacePathTab("/workspace/p1/compare"), "compare");
    assert.equal(parseWorkspacePathTab("/workspace/p1"), null);
    assert.equal(
      resolveWorkspaceTabFromParams({
        tab: "results",
        pathTab: parseWorkspacePathTab("/workspace/p1/workspace"),
      }),
      "results"
    );
  });

  it("maps seven Alt+number shortcuts to workspace tabs", () => {
    assert.equal(WORKSPACE_TAB_KEYBOARD_SHORTCUTS.length, 7);
    assert.equal(WORKSPACE_TAB_KEYBOARD_SHORTCUTS[1]?.tab, "results");
    assert.equal(WORKSPACE_TAB_KEYBOARD_SHORTCUTS[3]?.tab, "compare");
  });

  it("compare_scenarios detail opens compare tab with ids", () => {
    const detail = compareScenariosToolDetail(
      { scenarioIds: ["s1", "s2"], projectId: "p1" },
      { status: "ready", comparison: [] },
      "p1"
    );
    assert.equal(detail?.openTab, "compare");
    assert.deepEqual(detail?.compareScenarioIds, ["s1", "s2"]);
  });

  it("run_analysis mutation opens the results tab after completion", () => {
    const detail = mutationDetailFromToolResult(
      "run_analysis",
      { projectId: "p1" },
      { status: "completed", candidateCount: 12 },
      "p1"
    );
    assert.equal(detail?.openTab, "results");
  });

  it("resolves WebMCP aliases for load_project and exclude_from_selection", () => {
    assert.equal(PLANNING_TOOL_ALIASES.load_project, "get_workspace");
    assert.equal(PLANNING_TOOL_ALIASES.exclude_from_selection, "exclude_features");
  });

  it("list_projects returns catalog entries without 404", async () => {
    const ws = await services.createProject({
      name: "List projects tool",
      objectiveText:
        "Identify areas capable of accommodating 500 additional homes near transit.",
    });
    const result = await invokeTool("list_projects", {});
    assert.equal(result.ok, true);
    if (result.ok) {
      const payload = result.result as { count?: number; projects?: Array<{ id: string }> };
      assert.ok((payload.count ?? 0) >= 1);
      assert.ok(payload.projects?.some((project) => project.id === ws.project.id));
    }
  });
});
