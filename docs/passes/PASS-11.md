# Production Hardening Pass 11

Scope: Session persistence on Render, planner-facing crash guards, decision/compare UX, and missing friction on home + post-analysis flows.

Live reference: https://urban-planning-copilot.onrender.com/

## Root cause — persistence (P0)

Pass 10 reloaded from disk on **reads** (`listProjects`, `getWorkspace`) but **`updateStore` still mutated in-memory state** without re-reading `store.json` first. Concurrent PATCH requests (e.g. transit threshold `onChange` firing per keystroke, `run_analysis` + `update_constraints`) could interleave:

1. Request A loads memory snapshot v1  
2. Request B loads memory snapshot v1  
3. A writes v2 to disk  
4. B writes v1′ to disk → **last writer wins**, projects/scenarios vanish  

A corrupt or empty `store.json` read also triggered `ensureStore()` to **create and persist a blank store**, wiping the Render disk file.

### Fixes

| Area | Change |
|------|--------|
| `updateStore` | Always `reloadStoreFromDisk()` before mutate; serialize updates on a chain |
| `persist` | Atomic write + `.bak` backup before replace |
| `readStoreFromDisk` | Recover from `.bak` on parse failure; only seed empty store when no file exists |
| `runAnalysis` | Mid-flight state read uses `reloadStoreFromDisk()` |
| Transit threshold UI | Commit on blur/Enter (not per keystroke) to stop update storms |

## P0 — Null crash

`workspace?.scenarios.find(...)` evaluated `.find` on `undefined` when `workspace` was null during loading/error, surfacing `Cannot read properties of null (reading 'project')` in the red banner.

- Scenario/result derivation moved to safe `useMemo` hooks with full optional chaining  
- Loading and not-found states return before any unguarded `workspace.project` access  

## P1 — Planner UX

| Issue | Resolution |
|-------|------------|
| Raw enum toasts (`approve_scenario`) | `formatDecisionType` / `formatDecisionStatus` in UI + history |
| Compare needs two scenarios after branch | Compare tab pre-selects all scenarios with results, or current + parent |
| “No results yet” + stale map | Distinguish fresh / stale / none in `scenarioStatusLabel`; stale keeps last candidates visible |
| Transit 4000m silent accept | `normalizeTransitThresholdMeters` — warn >1200m walk, clamp >2400m bike; blur commit |
| Decision right pane blank | Decision tab split layout with read-only `PlanningMap` |

## Missing friction (built)

| Surface | Behavior |
|---------|----------|
| Home empty after wipe | `localStorage` recent-project hints; if server empty but browser had work → explain + Reload / New project; if recoverable → Open links |
| Post-analysis | Banner: Inspect top site · Compare scenarios · Record decision |

## Key files

- `src/lib/domain/store.ts` — durable read/modify/write + backup  
- `src/lib/domain/store.test.ts` — concurrency, backup recovery  
- `src/lib/domain/transit-threshold.ts` — walk/bike clamp + warnings  
- `src/lib/project-recency.ts` — browser recent-project hints  
- `src/lib/format.ts` — human decision labels  
- `src/app/workspace/[projectId]/workspace-client.tsx` — guards, status copy, decision map, CTAs  
- `src/app/page.tsx` — recovery empty state  

## Verify

```bash
npm test
npm run build
```

Workflow: create project → run analysis → refresh → project still listed → branch scenario → Compare shows two scenarios → edit transit threshold (4000 → clamped with warning) → Decision tab shows map + “Approved” toast labels.
