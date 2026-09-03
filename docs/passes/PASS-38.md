# PASS-38 — Planner feature correctness (create → decide workflow)

## Scope

Functional correctness pass on the planner journey. No `store-postgres.ts` changes, no token restyle, no persistence regressions.

## Shipped

### Compare tab selection
- Fixed compare chip deselection resetting to **all** analyzed scenarios when 3+ branches exist (`compareIds.length` dependency loop).
- Opening Compare now initializes once per visit via `defaultCompareScenarioIds` — active scenario + parent/child, not every analyzed branch.

### Branch → analyze flow
- `createScenario` / duplicate / sensitivity branch now sets `activeScenarioId` to the **new branch** so planners land on the branch ready to configure and run analysis.
- Resume notes and workspace toasts updated accordingly.

### Decision rationale
- Approve/Reject label now says reason is **required**; validation runs before the confirm modal (not only after API rejection).
- Request changes still allows empty reason but validates length when text is entered.

### Results filters ↔ map
- Flood/homes/shortlist filters lifted to workspace level so the main `PlanningMap` reflects the same filtered candidate set as the results drawer.
- Added **Below {target}-home target only** yield-gap filter when a housing target is resolved.

### Home storage vs empty list
- `/api/projects` storage diagnostics (`degraded`, missing store, read errors) surface as **Could not load projects** instead of “No projects yet”.

## Skipped (verified OK or out of scope)

| Area | Notes |
|------|--------|
| Create `/new` POST + GET verify | Already correct (pass 35) |
| Activity filters | `matchesActivityFilter` pipeline works; no code change |
| Report preview/export | Formatted sections + stale flags already honest |
| Copilot NL → tools | `planner-query` routes pin/branch/run to real MCP tools |
| Copilot compare → Compare tab | Copilot shows comparison in feed only; full tab state still manual — deferred |
| Explore → workspace convert | SessionStorage handoff works on happy path; server-side draft stash deferred |
| Compare maps sync | PASS-37 triple-map sync unchanged |

## Verification

```bash
npm test
npm run build
```

Manual: Compare with 3+ analyzed scenarios (deselect one — selection sticks); duplicate/branch (header shows new branch); results flood filter (map markers match drawer); Decision approve without reason (blocked before modal); home with storage degraded (error state, not empty).
