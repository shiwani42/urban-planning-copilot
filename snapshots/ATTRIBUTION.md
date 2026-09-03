# Data attribution

Urban Planning Copilot serves **checked-in snapshots** of San Francisco open data. The app does **not** call Socrata, 511.org, or FEMA at request time.

## Map basemap

| Layer | Provider | License / terms |
|-------|----------|-----------------|
| Voyager (default) | CARTO + OpenStreetMap | © OpenStreetMap contributors, © CARTO — [Carto attributions](https://carto.com/attributions) |

Configure an optional API key via `NEXT_PUBLIC_CARTO_API_KEY` (free at [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey)). Without a key, tiles are loaded from the Carto public CDN — not `tile.openstreetmap.org`.

## City open data (PDDL snapshots)

Refresh with `npm run ingest:sf`. Outputs live in `snapshots/sf/` (gzipped GeoJSON). Runtime workspace catalog (`store.json`) lives only in `DATA_DIR` (e.g. `/var/data` on Render).

| Dataset | Source | License | Vintage (snapshot) |
|---------|--------|---------|-------------------|
| Active parcels | [data.sfgov.org/d/acdm-wktn](https://data.sfgov.org/d/acdm-wktn) | PDDL | See `snapshots/sf/manifest.json` (`data_as_of` from source) |
| Muni stops | [Muni Stops (i28k-bkz6)](https://data.sfgov.org/Transportation/Muni-Stops/i28k-bkz6) | PDDL | See manifest |
| 100-year storm flood | [SFPUC flood risk (jzu3-4yxp)](https://data.sfgov.org/Public-Safety/100-Year-Storm-Flood-Risk-Zone-July-2022-/jzu3-4yxp) | PDDL | July 2022 model (see manifest) |
| Recreation and Parks | [Recreation and Parks Properties (gtr9-ntp6)](https://data.sfgov.org/Culture-and-Recreation/Recreation-and-Parks-Properties/gtr9-ntp6) | PDDL | See manifest |

**Demo AOI:** Mission & South of Market — clipped and simplified for browser performance. Not full city coverage.

## Illustrative layers (not city open data)

Population grid, schools, and infrastructure nodes remain **illustrative** synthetic supplements until a future ingest pass. They are labeled in the Data explorer and marked `synthetic: true` in dataset metadata where applicable. Parks in Mission/SoMa use the Recreation and Parks snapshot above.

## What we do not use

- Bhuvan snapshots
- `tile.openstreetmap.org` as a production tile CDN
- Overture parcels
- Live 511.org feeds
- Full California TIGER in `/data`
