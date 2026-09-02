# Production Hardening Pass 21 — exclusion scenario 404 and map export

Live reference: https://urban-planning-copilot.onrender.com/

## Pass 21 live walk (P0)

| Issue | Symptom | Root cause |
|-------|---------|------------|
| Scenario not found | Red banner after exclusion save / recalculate on Pass 20 study | Stale `scenarioId` in PATCH body or orphaned `activeScenarioId`; server returned 404 with no recovery |
| Map PNG export | Success toast, no file in Downloads | `captureMapPng` fired toast before async overlay render; download link not attached to DOM; tiles without `crossOrigin` taint canvas |
| Run analysis noop | First click looked idle; second click needed | `busy` cleared before UI showed running state; failures left stale results without feedback |
| Shortlist pin | Icon-only controls | Pin column used material icon without text label |

## Fixes (P0)

| Area | Change |
|------|--------|
| `scenario-resolution.ts` | Resolve scenario id: valid request → active scenario → Baseline → first remaining |
| `services.ts` | `repairActiveScenarioIfNeeded` on every `getWorkspace`; `requireScenario` uses resolver and repairs `activeScenarioId` |
| `workspace-client.tsx` | Auto-activate Baseline when active scenario missing; client-side scenario fallback in `useMemo` |
| `workspace-hooks.tsx` | On scenario-not-found PATCH error, refresh workspace (server repair) and clear banner; Retry clears error then reloads |
| `PlanningMap.tsx` | `captureMapPng` async: wait for tiles, draw overlay, append `<a>` to body, return success boolean |
| `BasemapLayer.tsx` | `crossOrigin="anonymous"` on raster tiles for canvas export |
| `workspace-client.tsx` | Export toast only on real download; `analysisBusy` for immediate Run/Recalculate spinner; `geoSaving` chip after exclusion draw |
| Results table | Pin / Unpin text labels beside icon; shortlist count in header breadcrumb |

## Fixes (P1)

| Area | Change |
|------|--------|
| Legend | Collapsible bottom-right toggle (Legend ▸/▾); float/dock control unchanged — see map controls |
| Map controls | Draw toolbar scrollable (`max-h`) so Finish/Undo are not clipped on short viewports |
| Activity panel | Inspector width 360px → 300px so center map gains horizontal space |
| Stale after exclusion | `criteriaStaleHint` + banner chip set on add/update/remove geographic selection |

## Legend toggle (operator note)

On the workspace map, bottom-right **Legend ▸** expands the layer swatch list. **Float legend / Dock legend** moves the panel between inline and docked modes. Legend is hidden while drawing exclusions or when the results drawer covers the corner (reduced opacity).

## Key files

- `src/lib/domain/scenario-resolution.ts` — id resolution + repair helpers
- `src/lib/domain/scenario-resolution.test.ts` — Baseline fallback, stale id
- `src/lib/domain/store.test.ts` — repair on load, stale id for geo selection
- `src/components/PlanningMap.tsx` — reliable PNG download
- `src/app/workspace/[projectId]/workspace-client.tsx` — recovery UX, busy states, shortlist labels

## Verify

```bash
npm test
npm run build
```

Manual:

1. Open Pass 20 study (or any scenario) → draw exclusion → Add area → confirm **Results stale** chip → Recalculate shows spinner → results refresh once.
2. Export PNG → file appears in Downloads (not toast-only).
3. Pin two sites on Results → reload → header shows **Shortlist: 2**; rows show **Pin** / **Unpin** labels.
4. If active scenario is orphaned, workspace auto-restores Baseline (no dead-end overlay).
