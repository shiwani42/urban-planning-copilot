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

**Live walk (pass 11, full):** The most reliable wipe was **duplicate scenario → switch to branch → Run analysis** (3/3 → “Project not found” + empty home). That path stacked concurrent writes from `create_scenario` and `run_analysis` on a branched scenario.

### Fixes

| Area | Change |
|------|--------|
| `updateStore` | Always `reloadStoreFromDisk()` before mutate; serialize updates on a chain |
| `persist` | Atomic write + `.bak` backup before replace |
| `readStoreFromDisk` | Recover from `.bak` on parse failure; only seed empty store when no file exists |
| `flushStoreWrites` | `reloadStoreFromDisk` awaits in-flight writes before reading |
| `runAnalysis` | Wrapped in per-project `withAnalysisGate`; mid-flight reads use `reloadStoreFromDisk()` |
| `createScenario` | `cloneScenarioForBranch` with explicit `projectId` match on source |
| Transit threshold UI | Text input with select-on-focus, digit-only draft, commit on blur/Enter (not per keystroke) |
| `useWorkspace.act` | Always `await refresh()` after successful PATCH |

## P0 — Null crash

`workspace?.scenarios.find(...)` evaluated `.find` on `undefined` when `workspace` was null during loading/error, surfacing `Cannot read properties of null (reading 'project')` in the red banner.

- Scenario/result derivation moved to safe `useMemo` hooks with full optional chaining  
- Loading and not-found states return before any unguarded `workspace.project` access  
- **Project not found** empty state explains session reset and offers **New project** / **Back to projects** (not bare red lines)

## P1 — Planner UX (live walk follow-up)

| Issue | Resolution |
|-------|------------|
| Duplicate + recalculate wipes store | Analysis gate + flush-before-read + duplicate integration test |
| Transit METERS input appends (800 → 800400) | Select-on-focus text field; commit on blur/Enter; 100–2000 m with human warnings |
| Priority sliders exceed 100%; Normalize steals flood weight | `rebalanceWeights` locks last-moved slider, scales others proportionally; removed silent Normalize button |
| Weight/constraint/geo edits leave map looking current | Immediate **Results stale — recalculate** chip via `criteriaStaleHint` |
| Raw enum toasts (`approve_scenario`) | `formatDecisionType` in UI + `touchProject` resume notes on server |
| Compare needs two scenarios after branch | Compare tab pre-selects all scenarios with results, or current + parent |
| “No results yet” + stale map | Distinguish fresh / stale / none in `scenarioStatusLabel`; stale keeps last candidates visible |
| Decision right pane blank | Decision tab split layout with read-only `PlanningMap` |
| Report → Download Markdown no-op | Blob download with delayed `revokeObjectURL`; toast on success/failure |
| Report/decision ignore housing target | `housingGoalSummary` in Decision + Report tabs; report body includes units vs target gap |
| Duplicate scenario keeps “Branch 2” name | `window.prompt` for name at duplicate time |

## Missing friction (built)

| Surface | Behavior |
|---------|----------|
| Home empty after wipe | `localStorage` recent-project hints; if server empty but browser had work → explain + Reload / New project; if recoverable → Open links |
| Post-analysis | Banner: Inspect top site · Compare scenarios · Record decision |

## Key files

- `src/lib/domain/store.ts` — durable read/modify/write + backup + flush  
- `src/lib/domain/store.test.ts` — concurrency, backup recovery, duplicate+recalculate  
- `src/lib/domain/scenario-clone.ts` — safe scenario branch copy  
- `src/lib/domain/weights.ts` — lock-slider rebalance  
- `src/lib/domain/transit-threshold.ts` — walk/bike clamp + warnings (100–2000 m UI)  
- `src/lib/domain/results-display.ts` — `housingGoalSummary`, `headlineMetric`  
- `src/lib/project-recency.ts` — browser recent-project hints  
- `src/lib/format.ts` — human decision labels  
- `src/app/workspace/[projectId]/workspace-client.tsx` — guards, status copy, decision map, CTAs, stale chip  
- `src/app/page.tsx` — recovery empty state  
- `src/components/workspace-hooks.tsx` — refresh after every PATCH  

## Out of scope (this pass)

Shapefile export, sharing/comments, equity criteria suite, address search, PDF/DOCX export.

## Verify

```bash
npm test
npm run build
```

Workflow: create project → run analysis → refresh → project still listed → **duplicate scenario (name prompt)** → switch branch → **Run analysis** → project still listed → edit transit threshold (type 400 over 800 → replaces, not appends) → move flood slider to 50% (others rebalance, flood stays 50%) → stale chip appears → recalculate → Decision tab shows map + housing gap vs target → **Approved** toast → Report → **Download Markdown** saves `.md`.
