# Pass 51 — Legacy load compaction (OOM on boot)

## Problem

Pass 49 compacted **writes** and lazy-hydrated **in-memory** candidates, but legacy Postgres/jsonb rows (e.g. probe XiBoAdzYqlBYb7VgWvI53 with 1667 inline parcel polygons) still OOM during `JSON.parse` on boot (~254 MB heap → death on 512 MB Render free).

## Fixes

### P0 — Pre-parse legacy compaction

- **`store-legacy-compact.ts`**: strip `geometry` and `provenance` from `analysisResults[].candidates[]` in the JSON **string** before `JSON.parse` (no heap materialization of polygons).
- **`parseStoreFile`**: always runs compaction before parse.
- **`loadStorePayloadFromPostgres`**: fetch `payload::text`, compact, then parse once.
- **Migrate-in-place**: when legacy compaction or interrupted-job reconcile runs on load, `persist()` rewrites the Postgres row compact.

### P1 — Render heap headroom

- **`render.yaml`**: `NODE_OPTIONS=--max-old-space-size=460` (supplement, not primary fix).

### Preserved from Pass 49

- Boot interrupted-job reconcile, lazy candidate hydration, MCP `ANALYSIS_IN_PROGRESS` budget, compact writes.

## Tests

- `store-legacy-compact.test.ts`: 1500-candidate string strip, in-place payload compact.
- `pass-51.test.ts`: postgres + file boot, `list_candidates`, housing re-run, MCP in-progress after legacy boot.
