# Pass 49 — OOM-safe housing analysis

## Problem

On Render free (~512 MB), housing analysis of ~1,667 SF parcels OOM'd the Node heap. The process died mid-run, leaving a stale prior result (all scores 50, service-access summary). MCP `run_analysis` blocked for 32s instead of returning `ANALYSIS_IN_PROGRESS`.

## Fixes

### P0 — Complete analysis without OOM

- **Chunked parcel scoring** (`spatial.ts`): process parcels in batches of 250; keep scalar metrics only (no full polygon geometry on candidates).
- **Compact candidates**: centroid `Point` geometry, empty per-candidate provenance calculations; full polygons stay in `featuresByDataset`.
- **Lazy hydration** (`store-persistence.ts`): on load, normalize candidates without reattaching every parcel polygon; hydrate on demand for `inspect_candidate`.
- **Denormalized score stats** on `AnalysisResult`: `candidateCount`, `scoreSpread`, `scoreMin`, `scoreMax` for fast `list_candidates`.

### P0 — Surface failed jobs

- **Boot reconcile** (`analysis-jobs.ts`): mark any `running` job as `failed` after service restart.
- **`list_candidates`**: returns `status: "error"` when latest run failed.
- **`get_workspace`**: exposes `analysisRunStatus` / `analysisError`.
- **UI banner** when latest job failed.

### P1 — MCP budget + fast paths

- **`runAnalysis`**: create job under a short gate, return immediately for async mode; heavy work runs in background.
- **`getAnalysisRunStatus` / `listCandidatesPage`**: use in-memory `getStore()` instead of full disk reload each poll.
- **`waitForAnalysisWithinBudget`**: don't return stale completed results while a new run is starting.

### Other

- **`reconcileScenarioObjectiveFromRawText`**: only replace constraints when intent actually changes (fixes user-disabled constraints being reset on recalc).
- **`scenarioUsesDataset`**: respect disabled constraint kinds in analysis-plan dataset usage.

## Tests

`pass-49.test.ts`: ~1.5k parcel compact analysis, failed-job surfacing, MCP in-progress, compact disk persist.
