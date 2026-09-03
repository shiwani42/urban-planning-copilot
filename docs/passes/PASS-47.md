# Production Hardening Pass 47 — WebMCP timeouts, scoring, schemas

Scope: Nekuda Workbench QA after Pass 46 — timeouts must not report ok, long `run_analysis` returns pollable in-progress state, partial-data scoring differentiates, tool schema properties have descriptions.

## P1 — Fixed

| Issue | Resolution |
| --- | --- |
| Page-tool timeout masquerades as ok | `webMcpToolOk` rejects timeout/abort text; `runWithPageToolBudget` races work against 25s budget; `coerceBrowserToolFailure` maps `AbortError` to `isError` |
| `run_analysis` returns before product state ready | Server polls within page-tool budget; returns `ANALYSIS_IN_PROGRESS` / running payload with `pollTools` when still running; browser asserts completed state before `notifyWorkspaceMutated` |
| `list_candidates` / `set_map_view` hit 30s timeout | Read tools stay fast; budget wrapper prevents hung browser execute |
| Flat 50.0 scores with partial data | Housing intent prioritized over park+school `service_access` misparsing; zero-variance criteria excluded from composite; transit/capacity/flood signals differentiate ranking |
| Misleading school-access headline with data gaps | `headlineMetric` hides 0-people school headline when limitations note missing datasets |

## P2 — Fixed

| Issue | Resolution |
| --- | --- |
| Workbench Audit schema warnings | All `PLANNING_TOOL_META` input properties now include `description` |

## Key files

- `src/lib/webmcp/page-tool-budget.ts` — shared page-tool budget helpers
- `src/lib/webmcp/tool-result.ts` — timeout coercion, in-progress errors
- `src/lib/webmcp/register-browser.ts` — budget-wrapped browser execute
- `src/lib/webmcp/server-handlers.ts` — analysis polling within budget
- `src/lib/domain/webmcp.ts` — `ANALYSIS_IN_PROGRESS` for HTTP bridge
- `src/lib/domain/objective.ts` — housing intent before service_access
- `src/lib/domain/spatial.ts` — partial-data scoring spread
- `src/lib/domain/pass-47.test.ts` — regression tests

## Verify

```bash
npm test
```

Agent loop: `run_analysis` → poll `list_candidates` when in-progress → completed analysis persists with differentiated scores.
