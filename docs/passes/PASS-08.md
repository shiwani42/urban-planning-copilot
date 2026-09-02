# Production Hardening Pass 08

Scope: Non-housing objective generalization — service-access studies must not run through the housing capacity engine.

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Non-housing objective headlined estimated housing capacity | Access intents emit gap KPIs (`total_school_underserved_pop`, etc.); housing capacity aggregate omitted |
| 2 | Per-candidate evidence used housing unit formulas | School/park evidence uses `school_underserved_pop` / `park_underserved_pop` and service-radius distances |
| 3 | Housing density assumptions attached to service-access studies | `defaultAssumptions` only adds `units_per_hectare` / `developable_fraction` for `housing_capacity` |
| 4 | Parks silently dropped when no dataset | `service_access` intent + `dataGaps` warning when parks referenced but `parks` dataset missing |
| 5 | Missing dataset treated as complete analysis | Data-gap chips in UI; limitations propagated to results and reports |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 6 | "Not a housing question" ignored | `NOT_HOUSING_RE` blocks `housing_capacity` intent; `excludesHousing` flag + UI chip |
| 7 | Results columns showed Capacity/Transit for access studies | Intent-aware `resultsColumnsForIntent` (school/park gap columns) |
| 8 | School service-radius assumptions not surfaced | Distance + underserved-pop metrics cite `school_service_radius_m` / `park_service_radius_m` |
| 9 | Unrelated flood weight scoring 100 on every row | Flood weight removed from access intents unless flood constraint present |
| 10 | Neighborhood vs parcel unit mismatch | `analysisUnit: neighborhood` adds limitation; parcel ranking disclosed |
| 11 | Farthest-parcel-wins gap ranking | Underservice scored by population beyond service radius, not distance percentile |
| 12 | Dedup / schools / population notes | Seed limitations expanded; population double-count note |
| 13 | Generate report first click no-op | Local loading state + spinner on first click |
| 14 | Row click evidence + stale banner | Row click dismisses stale-selection banner; opens evidence panel |
| 15 | Decorative constraint chips | Header chips show enabled engine constraints only |

## New capabilities

- `service_access` and `park_accessibility` planning intents
- Synthetic `parks` dataset in seed data (store migration adds to existing deployments)
- `src/lib/domain/intent.ts` and `results-display.ts` helpers

## Preserved

- Turf spatial engine
- WebMCP tools
- No Carto/SF ingest

## Verify locally

```bash
npm test
npm run build
```

Workflow: create project with objective *"Identify neighborhoods underserved by parks and schools. This is not a housing production question."* → run analysis → confirm headline shows underserved population (not homes), results columns show school/park gaps, evidence panel shows access-gap metrics.
