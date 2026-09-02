# Production Hardening Pass 05

Scope: Human geographic exclusion drawing — delete, edit vertices, draw-mode integrity, constraints visibility, and related polish.

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Cannot delete finished exclusion polygon | `remove_geo_selection` domain action + Delete in Constraints; marks results stale; recalc restores candidates |
| 2 | Cannot edit vertices after finish | Click polygon → edit mode with draggable vertices; Save persists via `update_geo_selection` |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 3 | Inclusion tool claimed but missing | Inclusion draw tool (`crop_free`) creates `type: "inclusion"` selections |
| 4 | Double-click zooms / adds verts in draw mode | `doubleClickZoom` disabled while drawing; dblclick swallowed in click handler |
| 5 | No finish/cancel/undo keyboard shortcuts | Finish/Save, Cancel, Undo controls; Escape cancels; Backspace undoes last vertex |
| 6 | Draw-mode clicks select parcels | Parcel layer `interactive={false}` while drawing |
| 7 | Legend / results drawer eat draw clicks | `pointer-events-none` on overlays during draw (legend toggle stays clickable) |
| 8 | Non-unique exclusion names | `uniqueGeographicLabel` + rename in Constraints; finish-name prompt |
| 9 | Report compare table blank em-dashes | Comparison tables render only for `kind: "comparison"`; Results sections use aggregate metric table |
| 10 | Exclusions not listed in Constraints | Geographic areas section with funnel detail, edit/rename/delete |
| 11 | No excluded parcel styling | Red hatched fill for parcels intersecting exclusion polygons; legend entry |
| 12 | `/new` create silent on success/error | Status banner for success (before redirect) and error (persisted) |

## Preserved

- Turf spatial engine
- snake_case WebMCP tools (+ `remove_map_area`, `update_map_area`)
- Synthetic geography (no OSM/Carto tiles)
- Live drawing funnel (`geographic_exclusion` step logs)

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: workspace → draw exclusion (3+ points) → Finish → name → recalculate → delete exclusion → recalculate (candidates restored) → click finished polygon → drag vertex → Save → Compare tab + Report comparison table show numeric metrics.
