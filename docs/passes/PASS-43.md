# PASS-43 — Workspace tab panels (distinct content per tab)

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Pass 42 fixed tab URL/state sync (`?tab=`, path deep links). Pass 43 wires each tab to a **distinct main panel** so planners are not left on the map when they choose Results, Evidence, Compare, Decision, Activity, or Report.

No `store-postgres.ts` changes, no secrets, no persistence regressions.

## Shipped

### Results tab (full panel, not map overlay)
- Map + context sidebar render only when `tab === "workspace"`.
- **Results** tab renders the candidate table, filters, yield gap, and evidence split view as a full-height panel (`ResultsDrawer` `layout="page"`).
- Workspace map keeps an optional bottom drawer for quick peek (`layout="drawer"`) without switching tabs.

### Other tabs (unchanged views, now visible)
- **Evidence** — dataset catalog with vintage/provenance chips (pass 42).
- **Compare** — KPI matrix, synced maps, prefer scenario.
- **Decision** — recommendation card, approve/reject with rationale gate.
- **Activity** — provenance filters (pass 37).
- **Report** — bento cards + generate/preview (not raw JSON dump).
- **Workspace** — map, context sidebar, copilot feed.

### Navigation
- `setTab` uses path URLs: `/workspace/:id/results` (and siblings for other tabs).
- `?tab=` and legacy `?initialTab=` still resolve via `resolveWorkspaceTabFromParams`.
- **Analysis complete** banner shows **View results** (one click) on any tab except Results; `run_analysis` still lands on Results.

## Verification

```bash
npm test
npm run build
```

Manual: click each tab — map only on Workspace; Results shows ranked table/filters; Evidence/Compare/Decision/Activity/Report show their panels; `/workspace/:id/results` and `?tab=results` both open Results; after Run analysis, View results / Results tab shows candidates.
