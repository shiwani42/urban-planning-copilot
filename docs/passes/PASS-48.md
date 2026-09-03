# Production Hardening Pass 48 — Ranking, MCP in-progress, candidate paging

Scope: Live probe on Neon Persist Probe 46 — stored `service_access` intent with flat score-50 rankings; MCP `run_analysis` blocking 100s+; `list_candidates` timing out on 1667 full candidates.

## P0 — Fixed

| Issue | Resolution |
| --- | --- |
| Stale `service_access` on re-run | `reconcileScenarioObjectiveFromRawText` re-parses `rawText` at analysis start; parks/schools in exclusion phrases are not service-access targets |
| Flat 50.0 scores | Housing intent restored before spatial engine runs; housing weights (transit/capacity/flood) differentiate ranking |
| Misleading service-access summary | Housing summaries no longer headline school-access gaps |

## P1 — Fixed

| Issue | Resolution |
| --- | --- |
| MCP `run_analysis` blocks past page-tool budget | Analysis runs in background (`setImmediate`); handler polls within 25s and returns `ANALYSIS_IN_PROGRESS` + `pollTools` |
| `list_candidates` slow / huge payload | `listCandidatesPage` returns top N + `totalCount` + `scoreSpread` without loading full workspace |

## Key files

- `src/lib/domain/objective.ts` — walk-time transit, exclusion-aware service types
- `src/lib/domain/services.ts` — reconcile at analysis, background job, `listCandidatesPage`
- `src/lib/webmcp/server-handlers.ts` — paginated `list_candidates`
- `src/lib/webmcp/page-tool-budget.ts` — `UPC_PAGE_TOOL_BUDGET_MS` test override
- `src/lib/domain/pass-48.test.ts` — regression tests

## Verify

```bash
npm test
```

Agent loop: `run_analysis` on probe objective → intent `housing_capacity`, score spread > 0; poll `list_candidates` when in-progress.
