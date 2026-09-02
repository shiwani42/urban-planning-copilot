import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeStoreShape, projectCountFromRawJson } from "./store-shape";

describe("store shape normalization", () => {
  it("defaults missing arrays without dropping existing projects", () => {
    const normalized = normalizeStoreShape({
      version: 1,
      projects: [{ id: "p1" } as never],
    });
    assert.equal(normalized.projects.length, 1);
    assert.deepEqual(normalized.scenarios, []);
    assert.deepEqual(normalized.proposals, []);
    assert.deepEqual(normalized.featuresByDataset, {});
  });

  it("counts projects from raw json", () => {
    assert.equal(
      projectCountFromRawJson(JSON.stringify({ projects: [{ id: "a" }, { id: "b" }] })),
      2
    );
    assert.equal(projectCountFromRawJson(""), null);
    assert.equal(projectCountFromRawJson("{bad"), null);
  });
});
