# PASS-41 — Live planner bug fixes (2026-09-03 walk)

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Fix confirmed production bugs from a live walk. No `store-postgres.ts` changes, no secrets, no false claims about Render disk durability.

## Shipped

### Storage honesty (Home + banner)
- `projectsPersistReliably()` gates persistence copy — file backend, degraded health, missing store, and `lastBoot=empty-after-missing-file` no longer show “persist across sessions”.
- `StorageBanner` surfaces ephemeral file storage (`persistBackend: file`) with a distinct heading and message.
- Empty “All other projects” section hidden when every project is already in Continue.

### Workspace `?tab=` deep links
- `/workspace/:id?tab=results|compare|decision|report|activity|evidence` selects the tab (legacy `?initialTab=` still works).
- Tab navigation uses `?tab=` hrefs; path routes remain compatible.

### POST `/api/projects` objective alias
- Accepts `objective` as an alias for `objectiveText`.
- Missing-objective errors name both fields.

### Empty analysis copy deduplication
- Single canonical status in the planning-objective sub-header (`EMPTY_ANALYSIS_STATUS`).
- Removed duplicate chip, map overlay, copilot empty-results sentence, and drawer “No results yet”.

### Map chrome overlap
- Consolidated exclude / include / export / legend into one right toolbar column offset from Leaflet zoom.
- Legend toggle is icon-only (no ghost “LEGEND” text stack).

### Explore map-first layout
- Base study-area map always visible behind the glass query panel.
- Run exploration enables when the query is non-empty; conversion footnote no longer contradicts the CTA.

### Results drawer + pane widths
- Drawer and handle lifted above Leaflet attribution (`bottom-7`).
- Context / inspector panes pinned to Stitch widths (360px / 320px) with min/max width tokens.

## Should-ship (included)

- Planner timestamps and greeting use the browser local timezone (not fixed IST).
- `/new` labels the SF Mission & SoMa demo AOI explicitly.

## Verification

```bash
npm test
npm run build
```

Manual: Home on file backend shows storage banner and honest empty copy; `/workspace/:id?tab=results` opens Results; POST with `objective` creates; workspace shows one empty-analysis line; map tools do not overlap zoom; Explore shows full-bleed map; drawer clears attribution.
