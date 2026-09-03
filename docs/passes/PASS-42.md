# PASS-42 — Live walk friction (cold start, catalog parity, tabs, freshness)

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Pass 41 follow-up from the 2026-09-03 production walk. No `store-postgres.ts` changes, no secrets, no false durability claims. Do not fight Render file-disk wipes — honesty and consistent reads only.

## Shipped

### P0 — Catalog vs GET parity
- `loadSharedStoreCatalog()` loads the store once for `/api/projects` and `/api/health`.
- Project list is built from that snapshot via `listHomeDashboardFromStore` — only projects `getWorkspaceFromStore` can open.
- Test: listed projects must load via `getWorkspace` on the same catalog.

### P1 — Health under-report
- Health `projectCount` uses listable projects from the loaded catalog (not a separate peek that can disagree).
- Degraded when `storeReadError`, ENOENT with phantom peek count, or index/catalog count mismatch.

### P1 — Workspace tab clicks
- Tab buttons call `setTab` + `?tab=` URL; URL sync no longer resets to Workspace when `?tab=` is momentarily empty during navigation.
- Client initial tab respects path-based deep links (`/workspace/:id/results`).

### PATCH `runAnalysis` alias
- `PATCH /api/projects/:id` accepts `runAnalysis` as an alias for `run_analysis` (same `runAnalysis` service path).

### Cold start wake UI
- `ServerWakeBanner` + `fetchJsonWithServerWake` when health/projects/workspace loads exceed ~3s or fail once, then retry.

### Priorities panel
- Apply only when weights differ from saved scenario; real `update_weights` save; clear run-analysis messaging.

### Dataset freshness
- Vintage stale / partial coverage chips on flood vs fresh parcels (`DatasetProvenanceChips`).

### Explore Run → convert
- `assessExploreQuestion` + server-wake retries on investigation fetch.

### Persistence copy
- Home empty state avoids “persist across sessions”; storage banner fallback softened.

## Verification

```bash
npm test
npm run build
```

Manual: list + GET same project id; health degraded when catalog unreadable; tab bar swaps Results/Evidence/etc.; `runAnalysis` PATCH runs analysis; cold start wake banner; priorities Apply; flood dataset chips.
