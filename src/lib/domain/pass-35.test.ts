import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  analysisStatusPresentation,
  continueCardActivity,
  inferContinueActivityKind,
  scenarioChipLabel,
} from "../home-dashboard";
import * as services from "./services";
import { listRecentAnalyses } from "./services";
import { resetStore } from "./store";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("pass 35 home dashboard helpers", () => {
  it("infers continue card activity kinds from resume notes", () => {
    assert.equal(inferContinueActivityKind("Agent recalculated candidates"), "ai");
    assert.equal(inferContinueActivityKind("Flood dataset integrated"), "data");
    assert.equal(inferContinueActivityKind("Approve scenario for report"), "manual");
  });

  it("formats continue card activity with relative time", () => {
    const card = continueCardActivity({
      resumeNote: "Analysis complete — 12 candidates.",
      updatedAt: "2026-09-02T10:00:00.000Z",
      lastOpenedAt: "2026-09-02T11:00:00.000Z",
    });
    assert.match(card.text, /candidates/i);
    assert.equal(card.kind, "ai");
    assert.ok(card.when.length > 0);
  });

  it("uppercases scenario chip labels", () => {
    assert.equal(scenarioChipLabel("Baseline"), "BASELINE");
    assert.match(scenarioChipLabel("Very long scenario name here"), /^VERY LONG/);
  });

  it("maps analysis status presentation tokens", () => {
    assert.equal(analysisStatusPresentation("completed").label, "Complete");
    assert.equal(analysisStatusPresentation("running").label, "Running");
    assert.equal(analysisStatusPresentation("failed").label, "Failed");
  });
});

describe("pass 35 recent analyses feed", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-pass35-test-${Date.now()}-${Math.random()}`;
    await resetStore();
  });

  afterEach(async () => {
    delete process.env.DATA_DIR;
  });

  it("lists recent analyses after a completed run", async () => {
    const ws = await services.createProject({
      name: "North River",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.scenarios[0]!.id;
    await services.runAnalysis(ws.project.id, scenarioId);
    const dashboard = await services.listHomeDashboard();
    assert.ok(dashboard.recentAnalyses.length >= 1);
    const row = dashboard.recentAnalyses.find((r) => r.projectId === ws.project.id);
    assert.ok(row);
    assert.equal(row!.projectName, "North River");
    assert.ok(["completed", "stale"].includes(row!.status));
  });

  it("listRecentAnalyses returns sorted rows with required fields", async () => {
    const ws = await services.createProject({
      name: "East Side",
      objectiveText: HOUSING_OBJECTIVE,
    });
    await services.runAnalysis(ws.project.id, ws.scenarios[0]!.id);
    const store = await import("./store").then((m) => m.reloadStoreFromDisk());
    const rows = listRecentAnalyses(store, 5);
    assert.ok(rows.length >= 1);
    for (const row of rows) {
      assert.ok(row.projectName.length > 0);
      assert.ok(row.analysisName.length > 0);
      assert.ok(row.timestamp);
    }
  });
});
