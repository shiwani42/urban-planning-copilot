# Production Hardening Pass 09

Scope: Replace synthetic North River layers with **snapshots** of real San Francisco open data so Carto/OSM basemap aligns with honest geography. No live Socrata/511/FEMA at request time.

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Delivered

| # | Item | Resolution |
|---|------|------------|
| 1 | Active parcels snapshot | `data/sf/parcels.geojson.gz` from [acdm-wktn](https://data.sfgov.org/d/acdm-wktn) — `active=true`, fields `blklot`, `zoning_code`, `zoning_district`, `analysis_neighborhood`; simplified; Mission & SoMa AOI |
| 2 | Muni stops snapshot | `data/sf/transit.geojson.gz` from [i28k-bkz6](https://data.sfgov.org/Transportation/Muni-Stops/i28k-bkz6) |
| 3 | SFPUC 100-year flood snapshot | `data/sf/flood.geojson.gz` from [jzu3-4yxp](https://data.sfgov.org/Public-Safety/100-Year-Storm-Flood-Risk-Zone-July-2022-/jzu3-4yxp), clipped to AOI |
| 4 | Carto/OSM basemap | `BasemapLayer` — Voyager raster, attribution © OSM + © CARTO; optional `NEXT_PUBLIC_CARTO_API_KEY` |
| 5 | Rename geography | North River → San Francisco; banner shows open-data demo area |
| 6 | Provenance | `synthetic=false` on city layers; source URL + vintage in dataset metadata; `data/ATTRIBUTION.md` |
| 7 | Ingest pipeline | `npm run ingest:sf` → `scripts/ingest-sf-open-data.mjs` |

## Preserved

- Turf spatial analysis engine
- snake_case WebMCP tools
- Geographic exclusion drawing (Pass 05)

## Not in this pass

- Population / schools / infrastructure — illustrative synthetic supplements
- Bhuvan, Overture parcels, live 511, full CA TIGER, `tile.openstreetmap.org` CDN

## Verify locally

```bash
npm run ingest:sf   # optional refresh when egress available
npm test
npm run build
npm run dev
```

Workflow: open workspace → basemap shows real streets under SF parcels → run analysis → Data page shows PDDL sources and `synthetic: false` for city layers.

## Egress / CI

If `npm run ingest:sf` fails in a restricted environment, the checked-in `data/sf/*.geojson.gz` subset is sufficient for build and tests. Re-run ingest when egress to `data.sfgov.org` is available.
