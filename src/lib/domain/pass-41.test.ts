import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as services from "./services";
import { resetStore } from "./store";
import {
  resolveWorkspaceTabFromParams,
  workspaceTabHref,
} from "@/lib/workspace-tabs";
import { EMPTY_ANALYSIS_STATUS } from "@/lib/workspace-analysis-status";

const HOUSING_OBJECTIVE =
  "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.";

describe("pass 41 live planner fixes", () => {
  it("accepts objective as alias for objectiveText on create", async () => {
    await resetStore();
    const ws = await services.createProject({
      name: "Objective alias test",
      objectiveText: services.resolveCreateObjectiveText({
        objective: HOUSING_OBJECTIVE,
      }) as string,
    });
    assert.equal(ws.scenarios[0]?.objective.rawText, HOUSING_OBJECTIVE);
  });

  it("names objectiveText and objective in missing-objective errors", async () => {
    await assert.rejects(
      () =>
        services.createProject({
          name: "Missing objective",
          objectiveText: services.resolveCreateObjectiveText({}) as string,
        }),
      /objectiveText or objective/i
    );
  });

  it("resolves workspace tabs from ?tab= query param", () => {
    assert.equal(
      resolveWorkspaceTabFromParams({ tab: "results", pathTab: "workspace" }),
      "results"
    );
    assert.equal(
      resolveWorkspaceTabFromParams({ initialTab: "compare", pathTab: "workspace" }),
      "compare"
    );
    assert.equal(workspaceTabHref("p1", "evidence"), "/workspace/p1/evidence");
    assert.equal(workspaceTabHref("p1", "workspace"), "/workspace/p1");
  });

  it("uses a single empty-analysis status sentence", () => {
    assert.match(EMPTY_ANALYSIS_STATUS, /run analysis/i);
  });
});
