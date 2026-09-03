import assert from "node:assert/strict";
import { describe, it, beforeEach, afterEach } from "node:test";
import type { AppStore } from "./types";
import {
  assertNotClobberingNonemptyPostgresCatalog,
  enableInMemoryPostgresForTests,
  getPersistBackend,
  isPostgresConfigured,
  loadStorePayloadFromPostgres,
  peekPostgresProjectCount,
  PostgresPersistError,
  resetPostgresBackendForTests,
  upsertStoreToPostgres,
  verifyPostgresWritable,
  documentsPatchFromStore,
  patchPostgresDocuments,
} from "./store-postgres";

function minimalStore(projectCount: number): AppStore {
  const projects = Array.from({ length: projectCount }, (_, i) => ({
    id: `p${i}`,
    name: `Project ${i}`,
    objectiveText: "Test objective",
    geographyLabel: "Test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    activeScenarioId: null,
    resumeNote: null,
    lastOpenedAt: null,
  }));
  return {
    version: 1,
    projects,
    scenarios: [],
    decisions: [],
    activities: [],
    confirmations: [],
    proposals: [],
    analysisJobs: [],
    analysisResults: [],
    reports: [],
    datasets: [],
    featuresByDataset: {},
  };
}

describe("store-postgres adapter", () => {
  let previousDatabaseUrl: string | undefined;

  beforeEach(() => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://test:test@localhost/test";
    resetPostgresBackendForTests();
    enableInMemoryPostgresForTests();
  });

  afterEach(() => {
    process.env.DATABASE_URL = previousDatabaseUrl;
    resetPostgresBackendForTests();
  });

  it("reports postgres backend when DATABASE_URL is set", () => {
    assert.equal(isPostgresConfigured(), true);
    assert.equal(getPersistBackend(), "postgres");
  });

  it("loads and upserts compact catalog payload", async () => {
    const store = minimalStore(2);
    await upsertStoreToPostgres(store, { allowEmptyCatalog: true });
    const raw = await loadStorePayloadFromPostgres();
    assert.ok(raw);
    const parsed = JSON.parse(raw) as AppStore;
    assert.equal(parsed.projects.length, 2);
    assert.equal(await peekPostgresProjectCount(), 2);
  });

  it("refuses to persist empty catalog over nonempty postgres row", async () => {
    await upsertStoreToPostgres(minimalStore(3), { allowEmptyCatalog: true });
    await assert.rejects(
      () => upsertStoreToPostgres(minimalStore(0)),
      (err: unknown) => {
        assert.ok(err instanceof PostgresPersistError);
        assert.match(err.message, /Refusing to persist empty catalog/);
        return true;
      }
    );
    assert.equal(await peekPostgresProjectCount(), 3);
  });

  it("allows first-run empty catalog when allowEmptyCatalog is set", async () => {
    assert.equal(await peekPostgresProjectCount(), null);
    await upsertStoreToPostgres(minimalStore(0), { allowEmptyCatalog: true });
    assert.equal(await peekPostgresProjectCount(), 0);
  });

  it("verifyPostgresWritable succeeds on in-memory backend", async () => {
    await assert.doesNotReject(() => verifyPostgresWritable());
  });

  it("assertNotClobberingNonemptyPostgresCatalog is a no-op for nonempty payload", async () => {
    await upsertStoreToPostgres(minimalStore(1), { allowEmptyCatalog: true });
    await assert.doesNotReject(() =>
      assertNotClobberingNonemptyPostgresCatalog(minimalStore(1))
    );
  });

  it("documents patch keeps analysis results and GIS features", async () => {
    const fat = minimalStore(1);
    fat.analysisResults = [
      {
        id: "r1",
        jobId: "j1",
        scenarioId: "s1",
        status: "completed",
        createdAt: "2026-01-01T00:00:00.000Z",
        candidates: [],
        aggregateMetrics: [],
        summary: "",
        limitations: [],
        stale: false,
        configHash: "test",
      },
    ];
    fat.datasets = [
      {
        id: "ds1",
        kind: "parcels",
        name: "Parcels",
        source: "test",
        version: "1",
        updatedAt: "2026-01-01T00:00:00.000Z",
        synthetic: false,
        coverage: "test",
        limitations: [],
        featureCount: 0,
        enabled: true,
        attributes: [],
      },
    ];
    fat.featuresByDataset = {
      ds1: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "Point", coordinates: [0, 0] },
          },
        ],
      },
    };
    await upsertStoreToPostgres(fat, { allowEmptyCatalog: true });

    const next = minimalStore(1);
    next.projects[0]!.resumeNote = "Pinned site";
    next.analysisResults = [];
    next.datasets = [];
    next.featuresByDataset = {};
    await patchPostgresDocuments(next);

    const raw = await loadStorePayloadFromPostgres();
    assert.ok(raw);
    const parsed = JSON.parse(raw) as AppStore;
    assert.equal(parsed.projects[0]?.resumeNote, "Pinned site");
    assert.equal(parsed.analysisResults.length, 1);
    assert.equal(parsed.datasets.length, 1);
    assert.ok(parsed.featuresByDataset.ds1);
    assert.equal("analysisResults" in documentsPatchFromStore(next), false);
  });
});

describe("store-postgres adapter without DATABASE_URL", () => {
  let previousDatabaseUrl: string | undefined;

  beforeEach(() => {
    previousDatabaseUrl = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    resetPostgresBackendForTests();
  });

  afterEach(() => {
    process.env.DATABASE_URL = previousDatabaseUrl;
    resetPostgresBackendForTests();
  });

  it("reports file backend when DATABASE_URL is unset", () => {
    assert.equal(isPostgresConfigured(), false);
    assert.equal(getPersistBackend(), "file");
  });
});
