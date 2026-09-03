import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import { resetStore } from "./store";
import * as services from "./services";
import { invokeTool } from "./webmcp";
import { resolveObjectiveTextWithGeography } from "./objective-geography";
import { parseMapCenter } from "./map-center";
import {
  assertBrowserToolProductState,
  webMcpToolError,
  webMcpToolOk,
} from "@/lib/webmcp/tool-result";
import {
  shouldShowEphemeralStorageBanner,
  shouldShowStorageUnavailableBanner,
  type ClientStorageStatus,
} from "@/lib/storage-status";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("pass-46 WebMCP agent loop", () => {
  beforeEach(async () => {
    process.env.DATA_DIR = `/tmp/upc-pass46-${Date.now()}-${Math.random()}`;
    await resetStore();
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
  });

  it("run_analysis persists analysis visible to list_candidates", async () => {
    const ws = await services.createProject({
      name: "Pass 46 analysis",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const scenarioId = ws.project.activeScenarioId!;
    const run = await invokeTool("run_analysis", {
      projectId: ws.project.id,
      scenarioId,
    });
    assert.equal(run.ok, true);
    if (run.ok) {
      const payload = run.result as { status: string; candidateCount?: number };
      assert.equal(payload.status, "completed");
      assert.ok((payload.candidateCount ?? 0) > 0);
    }

    const listed = await invokeTool("list_candidates", {
      projectId: ws.project.id,
      scenarioId,
    });
    assert.equal(listed.ok, true);
    if (listed.ok) {
      const candidates = (listed.result as { candidates?: unknown[] }).candidates ?? [];
      assert.ok(candidates.length > 0);
    }

    const reloaded = await services.getWorkspace(ws.project.id);
    const scenario = reloaded?.scenarios.find((s) => s.id === scenarioId);
    assert.ok(scenario?.latestResultId);
  });

  it("list_candidates without analysis returns structured error", async () => {
    const ws = await services.createProject({
      name: "No analysis yet",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("list_candidates", {
      projectId: ws.project.id,
      scenarioId: ws.project.activeScenarioId,
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "NO_ANALYSIS");
    }
  });

  it("browser tool wrappers surface isError for failures", () => {
    const ok = webMcpToolOk({ status: "completed", candidateCount: 3 });
    assert.equal(ok.isError, undefined);
    const err = webMcpToolError("No analysis results for this scenario");
    assert.equal(err.isError, true);
    assert.match(err.content[0]?.text ?? "", /No analysis/);
  });

  it("assertBrowserToolProductState rejects incomplete run_analysis", () => {
    assert.throws(
      () => assertBrowserToolProductState("run_analysis", { status: "running" }),
      /still running/i
    );
    assert.throws(
      () => assertBrowserToolProductState("run_analysis", { status: "completed", candidateCount: 0 }),
      /no candidates/i
    );
    assert.doesNotThrow(() =>
      assertBrowserToolProductState("run_analysis", {
        status: "completed",
        candidateCount: 12,
      })
    );
  });

  it("resolveObjectiveTextWithGeography does not duplicate geography", () => {
    const objective =
      "Site 2000 homes near transit outside flood zones in Mission/SoMa, San Francisco";
    const resolved = resolveObjectiveTextWithGeography(objective, "Mission/SoMa, San Francisco");
    assert.equal(resolved, objective);
    const appended = resolveObjectiveTextWithGeography(
      "Site 2000 homes near transit outside flood zones",
      "Mission/SoMa, San Francisco"
    );
    assert.equal(
      appended,
      "Site 2000 homes near transit outside flood zones in Mission/SoMa, San Francisco"
    );
  });

  it("parseMapCenter accepts array and comma-separated string", () => {
    assert.deepEqual(parseMapCenter([-122.3893, 37.7955]), [-122.3893, 37.7955]);
    assert.deepEqual(parseMapCenter("-122.3893,37.7955"), [-122.3893, 37.7955]);
  });

  it("set_map_view accepts comma-separated center string", async () => {
    const ws = await services.createProject({
      name: "Map center string",
      objectiveText: HOUSING_OBJECTIVE,
    });
    const result = await invokeTool("set_map_view", {
      projectId: ws.project.id,
      center: "-122.415,37.765",
      zoom: 15,
    });
    assert.equal(result.ok, true);
    const updated = await services.getWorkspace(ws.project.id);
    assert.deepEqual(updated?.project.mapState.viewport.center, [-122.415, 37.765]);
  });
});

describe("pass-46 storage banner gating", () => {
  it("hides ephemeral banner when postgres is healthy", () => {
    const storage: ClientStorageStatus = {
      status: "healthy",
      persistBackend: "postgres",
      postgresOk: true,
      writeProbeOk: true,
    };
    assert.equal(shouldShowEphemeralStorageBanner(storage), false);
    assert.equal(shouldShowStorageUnavailableBanner(storage), false);
  });

  it("shows ephemeral banner for file backend", () => {
    const storage: ClientStorageStatus = {
      status: "healthy",
      persistBackend: "file",
      writeProbeOk: true,
    };
    assert.equal(shouldShowEphemeralStorageBanner(storage), true);
    assert.equal(shouldShowStorageUnavailableBanner(storage), false);
  });

  it("shows unavailable banner when postgres probe fails", () => {
    const storage: ClientStorageStatus = {
      status: "degraded",
      persistBackend: "postgres",
      postgresOk: false,
      writeProbeOk: false,
      message: "Postgres write probe failed",
    };
    assert.equal(shouldShowEphemeralStorageBanner(storage), false);
    assert.equal(shouldShowStorageUnavailableBanner(storage), true);
  });
});
