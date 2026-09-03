# Pass 52 — Postgres-only persist and analysis re-run hardening

## Problem

After Pass 51 boot OOM fix, probe XiBoAdzYqlBYb7VgWvI53 still blocked on:

- **File cache writes** on Postgres-primary Render: `store.json.tmp` stringify/parse failures crashed `npm start` mid re-run.
- **MCP `run_analysis`** timed out at 30s: handler returned the *old* completed result (flat score-50 service-access) instead of `ANALYSIS_IN_PROGRESS` while housing re-run was in flight.
- **Duplicate analysis blobs** in Neon (~3.2 MB): two completed 1667-candidate results per scenario.
- **`list_candidates`** ~33s on bloated store (blocked on file-cache persist queue).

## Fixes

### P0 — Skip file-store when `persistBackend` is postgres

- `store.ts`: removed `writeFileCacheBestEffort` on postgres persist and postgres boot load. Postgres row is the only durable write.

### P0 — Housing re-run replaces stale flat scores

- `runAnalysis` marks prior results stale before enqueueing a new job.
- `dedupeAnalysisResultsPerScenario` on boot and after each completed run keeps only `scenario.latestResultId`.

### P1 — MCP `run_analysis` returns in-progress quickly

- `waitForAnalysisWithinBudget` tracks `expectedJobId` / `resultJobId` so stale completed rows do not satisfy the poll.
- Handler awaits job creation, then polls within page-tool budget.

### P2 — Faster `list_candidates`

- Single `getStore()` pass for status + page data (no double load).
- Removing multi-MB file-cache writes unblocks the persist queue.

## Tests

- `pass-52.test.ts`: postgres never writes `store.json`; dedupe; housing re-run replaces stale 50s; MCP in-progress with legacy postgres row.
