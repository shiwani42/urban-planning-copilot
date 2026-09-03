# PASS-42 — Live walk friction (cold start, priorities, freshness, explore)

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Pass 41 follow-up from the 2026-09-03 production walk. No `store-postgres.ts` changes, no secrets, no false durability claims.

## Shipped

### Cold start wake UI
- Shared `fetchJsonWithServerWake` shows a **Waking the server…** banner when `/api/health` or `/api/projects` (and workspace loads) exceed ~3s or fail once, then retries.
- Banner does not fake success — pages still error if the server never responds.

### Priorities panel honesty
- Sliders remain live; **Apply priorities** only enables when weights differ from the saved scenario.
- Apply performs a real `update_weights` save; moving sliders alone no longer marks results stale in the UI.
- Clear states: unsaved draft, saved-but-awaiting-analysis, and the standing note that rankings change only after analysis.

### Dataset freshness presentation
- SFPUC flood (2022 vintage, single clipped feature) shows **Vintage stale** and **Partial coverage** alongside honest **Observed** provenance — not the same treatment as 2026 parcels.
- Shared `DatasetProvenanceChips` on Data explorer, workspace Evidence, and dataset inspect panel.

### Explore Run → convert
- Investigation uses `assessExploreQuestion` (aligned with API routing) and `fetchJsonWithServerWake` for cold starts.
- Run stays enabled for non-empty queries; convert CTA still appears after a successful run.

### Persistence copy scan
- Home empty state uses “saved on the server while storage is healthy” instead of “persist across sessions”.
- `StorageBanner` fallback avoids “persist across” phrasing.

## Verification

```bash
npm test
npm run build
```

Manual: cold start on Render free shows wake banner then loads; priority sliders → Apply → run analysis message; Data explorer flood row shows stale/partial chips; Explore non-empty query runs and convert POSTs a project.
