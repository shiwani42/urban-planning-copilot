import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveWorkspaceTabFromParams,
  workspaceTabHref,
  WORKSPACE_TABS,
} from "../workspace-tabs";

describe("pass 43 workspace tab panels", () => {
  it("maps path /workspace/:id/results to the results tab", () => {
    assert.equal(
      resolveWorkspaceTabFromParams({ pathTab: "results" }),
      "results"
    );
    assert.equal(workspaceTabHref("proj-1", "results"), "/workspace/proj-1/results");
  });

  it("keeps ?tab= equivalent to path segment for every non-workspace tab", () => {
    for (const tab of WORKSPACE_TABS) {
      if (tab === "workspace") continue;
      assert.equal(
        resolveWorkspaceTabFromParams({ tab, pathTab: "workspace" }),
        tab,
        `?tab=${tab} should win over workspace path`
      );
      assert.equal(
        resolveWorkspaceTabFromParams({ pathTab: tab }),
        tab,
        `/workspace/:id/${tab} path should resolve`
      );
      assert.equal(
        workspaceTabHref("abc", tab),
        `/workspace/abc/${tab}`,
        `setTab href for ${tab}`
      );
    }
  });

  it("workspace tab uses the base project path without a segment", () => {
    assert.equal(workspaceTabHref("abc", "workspace"), "/workspace/abc");
    assert.equal(resolveWorkspaceTabFromParams({ pathTab: "workspace" }), "workspace");
  });
});
