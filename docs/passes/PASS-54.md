# Pass 54 — Planner tool speed and honest yield

Scope: Page tools should move the map and shortlist immediately. Persist stays on the pooled catalog; analysis rows and GIS features are not rewritten on pin/pan. Planner copy leads with the 2,000-home shortfall.

## Tool path

| Tool | Before | After |
|------|--------|-------|
| `set_map_view` | HTTP + full catalog persist + workspace reload | Leaflet + local viewport first; documents persist in the background |
| `add_to_shortlist` / unpin | Full catalog write (~572 candidates) | Optimistic pin; documents jsonb patch; compact `{ candidateId, shortlistCount }` |
| `list_candidates` | Full store reload | In-memory page from the open study (limit/offset, no geometries) |
| `get_workspace` / list | `reloadStoreFromDisk` + repair persist | Memory store; repair only when needed |

Keep-alive pings `/api/ping` while a tab is visible (no user-facing chrome). File-cache `store.json` stays off when the catalog is primary.

## Planner surfaces

- Home continue: one card for Client Demo SF Housing (duplicate Mission/SoMa housing studies stay in All projects).
- Geography: Mission/SoMa, San Francisco — never “Study area”.
- Ranking chip when the last run’s housing target disagrees with the current brief.
- Yield copy leads with shortfall vs 2,000 homes and how to close the gap.
- Flood coverage disclaimer once in evidence; map styles parcels outside the flood layer extent.
- Workspace panes 360/320, shrinking with viewport so 1280px + agent panel still reads.
- Map chrome sits below the objective chips. Right pane is Findings (plan feed), not a chat widget.
- Compare shows maps before the metrics table.

## Tests

- `src/lib/domain/pass-54.test.ts`
- documents patch keeps analysis/GIS rows
- flood coverage gap ids
- planner-copy forbidden terms still green
