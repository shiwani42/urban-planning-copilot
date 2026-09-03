import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  parseCompareScenarioIds,
  resolveWorkspaceTab,
  resolveWorkspaceTabFromParams,
  workspaceTabHref,
  workspaceTabUrl,
} from "./workspace-tabs";

describe("resolveWorkspaceTab", () => {
  it("honors activity and report deep-link query values", () => {
    assert.equal(resolveWorkspaceTab("activity"), "activity");
    assert.equal(resolveWorkspaceTab("report"), "report");
  });

  it("falls back to workspace for unknown values", () => {
    assert.equal(resolveWorkspaceTab("nope"), "workspace");
    assert.equal(resolveWorkspaceTab(undefined), "workspace");
    assert.equal(resolveWorkspaceTab(null), "workspace");
  });

  it("keeps pass-6 path tabs valid", () => {
    assert.equal(resolveWorkspaceTab("evidence"), "evidence");
    assert.equal(resolveWorkspaceTab("decision"), "decision");
  });

  it("prefers ?tab= over path segment for deep links", () => {
    assert.equal(
      resolveWorkspaceTabFromParams({ tab: "results", pathTab: "workspace" }),
      "results"
    );
    assert.equal(workspaceTabHref("abc", "compare"), "/workspace/abc/compare");
    assert.equal(workspaceTabHref("abc", "results"), "/workspace/abc/results");
  });

  it("serializes compare scenario ids for compare tab URLs", () => {
    assert.equal(
      workspaceTabUrl("abc", "compare", { compareScenarioIds: ["s1", "s2"] }),
      "/workspace/abc/compare?compareScenarioIds=s1%2Cs2"
    );
    assert.deepEqual(parseCompareScenarioIds("s1,s2"), ["s1", "s2"]);
  });
});
