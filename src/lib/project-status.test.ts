import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { projectStatusLine, projectStatusTone } from "./project-status";

describe("projectStatusLine", () => {
  it("consolidates analysis and shortlist without duplicate boxes", () => {
    const line = projectStatusLine({
      id: "p1",
      name: "Pass25",
      activeScenarioNote: "No analysis yet — run analysis for this scenario.",
      resumeNote: "No analysis yet — run analysis for this scenario.",
    });
    assert.equal(line, "No analysis yet — run analysis for this scenario.");
  });

  it("includes branches and pins in one line", () => {
    const line = projectStatusLine({
      id: "p1",
      name: "Mission",
      scenarioCount: 2,
      scenarioSummary: "Baseline · Flood-weighted",
      activeScenarioNote: "Analysis complete — 572 candidates (Baseline)",
      shortlistCount: 1,
    });
    assert.match(line, /2 branches/);
    assert.match(line, /572 candidates/);
    assert.match(line, /1 pinned site/);
  });

  it("prefers approved label when present", () => {
    const line = projectStatusLine({
      id: "p1",
      name: "X",
      approvedScenarioName: "Baseline",
      activeScenarioNote: "Analysis complete — 10 candidates (Baseline)",
    });
    assert.match(line, /Approved · Baseline/);
  });
});

describe("projectStatusTone", () => {
  it("marks stale notes as attention", () => {
    assert.equal(
      projectStatusTone({
        id: "p1",
        name: "X",
        resumeNote: "Recalculate analysis — inputs changed.",
      }),
      "attention"
    );
  });
});
