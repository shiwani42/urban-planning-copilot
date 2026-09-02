# Production Hardening Pass 12

Scope: Render persistence that actually survives concurrent writes, degraded-mode visibility when disk is unusable, and evidence/map UX fixes from the live walk.

Live reference: https://urban-planning-copilot.onrender.com/

## Root cause — persistence (P0)

Pass 11 fixes were not on `main`. Verified failure modes:

| Mode | What happened |
|------|----------------|
| Concurrent `updateStore` | Last writer overwrote disk with stale in-memory snapshot — projects vanished after duplicate + recalculate |
| Corrupt/partial `store.json` read | `ensureStore()` catch block created **empty store and persisted it**, wiping the Render disk |
| No write flush before read | `reloadStoreFromDisk()` could read mid-rename |
| No backup | Unrecoverable after a bad write |

Live walk: workspace created, 572 candidates analyzed, then Report 404, `/api/projects` empty, six further creates failed with “Project not found”.

### Fixes

| Area | Change |
|------|--------|
| `store.ts` | Serialize `updateStore` on a chain; always `reloadStoreFromDisk()` before mutate |
| `persist` | Atomic tmp → rename; `.bak` copy before replace |
| `readStoreFromDisk` | Recover from `.bak`; never seed empty store when primary exists but is corrupt |
| `flushStoreWrites` | Await in-flight writes before reads |
| `runAnalysis` | Per-project `withAnalysisGate` |
| `createScenario` | `cloneScenarioForBranch` with explicit `projectId` match |
| `storage-health.ts` | Track healthy/degraded; writable-dir probe |
| `/api/health` | Expose storage status, path, project count |
| `StorageBanner` | Loud degraded banner on home, data, workspace — never silent RAM mode |
| `createProject` | Fail with actionable message if post-create load misses project |

Home copy no longer mentions “when the Render data disk is attached.”

## P1 — Evidence & map UX

| Issue | Resolution |
|-------|------------|
| Evidence Inspect chips no-op | `DatasetInspectPanel` — completeness, coverage, vintage, fitness |
| Giant legend overlay | Docked bottom-right, compact, collapsible |
| No color swatches on layer checkboxes | `layer-styles.ts` swatches on sidebar + legend |
| Material icon ligatures as text | `font-family: "Material Symbols Outlined"` on `.material-symbols-outlined` |
| Flood 1-feature excludes parcels silently | Results banner when incomplete flood coverage excludes many parcels |
| Explore dumps 17 caveats | `filterAnalysisCaveats` — severity-ranked, max 5 + overflow note |
| No analysis progress | Running state with step count and ETA hint |
| Create fails silently | `localStorage` draft restored on server failure |

## P2 — Cheap wins

| Issue | Resolution |
|-------|------------|
| Map PNG export | `captureMapPng` on workspace map |
| `/data` empty on cold load | Loading skeleton cards |
| Mark outdated global, no confirm | `window.confirm` before marking stale |

## Key files

- `src/lib/domain/store.ts` — durable read/modify/write + backup + health
- `src/lib/domain/store.test.ts` — concurrency, backup recovery, duplicate+recalculate
- `src/lib/domain/storage-health.ts` — degraded mode tracking
- `src/lib/domain/scenario-clone.ts` — safe scenario branch copy
- `src/lib/domain/layer-styles.ts` — shared swatch colors
- `src/lib/domain/caveats.ts` — severity-filtered caveat lists
- `src/app/api/health/route.ts` — storage diagnostics
- `src/components/StorageBanner.tsx` — degraded banner
- `src/components/DatasetInspectPanel.tsx` — per-dataset inspect drawer
- `src/app/workspace/[projectId]/workspace-client.tsx` — legend, layers, progress, flood warning
- `src/components/workspace-hooks.tsx` — always refresh after PATCH

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: create project → run analysis → duplicate scenario → recalculate → reload home (project still listed) → Evidence Inspect opens panel → degraded banner appears if `DATA_DIR` is not writable.
