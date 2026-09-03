import assert from "node:assert/strict";
import { test } from "node:test";
import { layerSwatch } from "./layer-styles";
import { describeWorkspaceOutcome } from "../copilot/workspace-outcome";
import { summarizeToolResult } from "../copilot/planner-query";
import {
  ANALYSIS_RUNNING_FEED,
  COPILOT_ACTION_FAILED,
  DRAWING_MAP_HINT,
  EXCLUDE_AREA_HELP,
  FINDINGS_EMPTY_OUTCOME,
  FINDINGS_PLAN_INTRO,
  LAYERS_SCORE_NOTE,
} from "../planner-copy";

test("findings copy is planner language, not a first-person chat", () => {
  assert.doesNotMatch(FINDINGS_PLAN_INTRO, /\bI['’]ve\b/i);
  assert.doesNotMatch(FINDINGS_PLAN_INTRO, /\bbefore I run\b/i);
  assert.match(FINDINGS_PLAN_INTRO, /analysis plan/i);
  assert.match(FINDINGS_EMPTY_OUTCOME, /Findings/);
});

test("drawing copy tells planners the map will not pan", () => {
  assert.match(DRAWING_MAP_HINT, /will not pan/i);
  assert.match(DRAWING_MAP_HINT, /Escape/);
  assert.match(DRAWING_MAP_HINT, /Backspace/);
  assert.match(EXCLUDE_AREA_HELP, /Parcel clicks are ignored/);
});

test("legend labels match the layers used in scores", () => {
  assert.match(layerSwatch("flood").label, /SFPUC/);
  assert.match(layerSwatch("transit").label, /Muni/);
  assert.match(LAYERS_SCORE_NOTE, /SFPUC/);
  assert.match(LAYERS_SCORE_NOTE, /Muni/);
  assert.match(LAYERS_SCORE_NOTE, /not FEMA/i);
});

test("running analysis and failed commands point at Findings, not a chat widget", () => {
  assert.equal(
    summarizeToolResult("run_analysis", { status: "running" }),
    ANALYSIS_RUNNING_FEED
  );
  assert.match(ANALYSIS_RUNNING_FEED, /Findings/);
  const failed = describeWorkspaceOutcome({
    copilotActivity: [
      {
        id: "a1",
        tool: "run_analysis",
        status: "error",
        summary: "",
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(failed, COPILOT_ACTION_FAILED);
  assert.equal(describeWorkspaceOutcome({}), FINDINGS_EMPTY_OUTCOME);
});
