import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resetStore } from "./store";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import {
  isCandidateShortlisted,
  resolveShortlist,
  shortlistPinReason,
} from "./shortlist";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("candidate shortlist (pass 13)", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-shortlist-test-${Date.now()}-${Math.random()}`;
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  async function projectWithResults() {
    const ws = await services.createProject({
      name: "Shortlist test",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    await services.runAnalysis(ws.project.id, scenarioId);
    const fresh = await services.getWorkspace(ws.project.id);
    const scenario = fresh!.scenarios.find((s) => s.id === scenarioId)!;
    const result = fresh!.analysisResults.find((r) => r.id === scenario.latestResultId)!;
    const candidate = result.candidates[0]!;
    return { projectId: ws.project.id, scenarioId, candidate, result };
  }

  it("pins and lists candidates on the scenario shortlist", async () => {
    const { projectId, scenarioId, candidate } = await projectWithResults();
    const ws = await services.addToShortlist(projectId, scenarioId, candidate.id, {
      reason: "Strong transit access",
      note: "Near BART",
    });
    const scenario = ws!.scenarios.find((s) => s.id === scenarioId)!;
    assert.equal(scenario.shortlist?.length, 1);
    assert.equal(scenario.shortlist![0].label, candidate.label);
    assert.equal(scenario.shortlist![0].reason, "Strong transit access");
    assert.equal(scenario.shortlist![0].note, "Near BART");

    const listed = await invokeTool("list_shortlist", { projectId, scenarioId });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      const data = listed.result as {
        count: number;
        message: string;
        candidateIds: string[];
        shortlist: Array<{ label: string }>;
      };
      assert.equal(data.count, 1);
      assert.equal(data.shortlist[0].label, candidate.label);
      assert.match(data.message, /Shortlist has 1 site/);
      assert.deepEqual(data.candidateIds, [candidate.id]);
    }
  });

  it("removes a candidate from the shortlist", async () => {
    const { projectId, scenarioId, candidate } = await projectWithResults();
    await services.addToShortlist(projectId, scenarioId, candidate.id);
    const removed = await invokeTool("remove_from_shortlist", {
      projectId,
      scenarioId,
      candidateId: candidate.id,
    });
    assert.equal(removed.ok, true);
    const ws = await services.getWorkspace(projectId);
    const scenario = ws!.scenarios.find((s) => s.id === scenarioId)!;
    assert.equal(scenario.shortlist?.length ?? 0, 0);
  });

  it("rejects shortlisting a rejected candidate", async () => {
    const { projectId, scenarioId, candidate } = await projectWithResults();
    await services.recordDecision({
      projectId,
      scenarioId,
      type: "reject_candidate",
      subjectId: candidate.id,
      reason: "Flood risk",
    });
    const result = await invokeTool("add_to_shortlist", {
      projectId,
      scenarioId,
      candidateId: candidate.id,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "INVALID_INPUT");
  });

  it("remaps shortlist entries after re-analysis", async () => {
    const { projectId, scenarioId, candidate } = await projectWithResults();
    await services.addToShortlist(projectId, scenarioId, candidate.id, {
      reason: "Keep for decision",
    });

    await services.runAnalysis(projectId, scenarioId);
    const after = await services.getWorkspace(projectId);
    const afterScenario = after!.scenarios.find((s) => s.id === scenarioId)!;
    const afterResult = after!.analysisResults.find(
      (r) => r.id === afterScenario.latestResultId
    )!;
    const resolved = resolveShortlist(afterScenario, afterResult);
    assert.equal(resolved.length, 1);
    assert.ok(resolved[0].candidate);
    assert.equal(resolved[0].candidate!.label, candidate.label);
    assert.equal(shortlistPinReason(resolved[0]), "Keep for decision");
  });

  it("drops shortlist entries when candidate is rejected", async () => {
    const { projectId, scenarioId, candidate } = await projectWithResults();
    await services.addToShortlist(projectId, scenarioId, candidate.id);
    await services.recordDecision({
      projectId,
      scenarioId,
      type: "reject_candidate",
      subjectId: candidate.id,
      reason: "Too steep",
    });
    const ws = await services.getWorkspace(projectId);
    const scenario = ws!.scenarios.find((s) => s.id === scenarioId)!;
    assert.equal(scenario.shortlist?.length ?? 0, 0);
  });

  it("survives store reload", async () => {
    const { projectId, scenarioId, candidate } = await projectWithResults();
    await services.addToShortlist(projectId, scenarioId, candidate.id);
    const reloaded = await services.getWorkspace(projectId);
    const scenario = reloaded!.scenarios.find((s) => s.id === scenarioId)!;
    const result = reloaded!.analysisResults.find((r) => r.id === scenario.latestResultId)!;
    const pinned = result.candidates.find((c) => c.id === candidate.id)!;
    assert.ok(isCandidateShortlisted(scenario, pinned));
  });
});
