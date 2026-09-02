import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveWorkspaceTab } from "./workspace-tabs";

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
});
