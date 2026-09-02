# Production Hardening Pass 04

Scope: Explore scratch investigations — spatial gap/siting routing, calibrated ranking, map + evidence, convert handoff (EVAL: investigate without creating a project).

Live reference: https://urban-planning-copilot.onrender.com/explore

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Score 100.0 ceiling on Upland areas; ties unbreakable | Percentile-calibrated gap scores (1–99 spread); tie-break by distance metric then feature id |
| 2 | Rank order contradicts Score column | Removed post-score distance re-sort; rank = score sort order; methodology documents sort key |
| 3 | Duplicate row identity (e.g. two “Upland D”) | Unique parcel labels in seed (`Upland A-28` style); candidate ids remain unique feature ids |
| 4 | School vs transit questions return identical results | `runExploreInvestigation` routes `school_gap` vs `transit_gap` with distinct weights, KPIs, summaries, and rankings |
| 5 | Unrelated questions return housing output | `assessExploreQuestion` rejects unsupported topics (parking, etc.) with 400 + clear message |
| 6 | Transit-gap answered with siting shortlist | Gap profile uses gap KPIs (`gap_area_count`, median distance), gap summary copy, no housing capacity aggregate |
| 7 | Convert discards scratch session | `EXPLORE_CONVERT_KEY` sessionStorage draft pre-fills `/new` name + objective + findings snapshot; no project until Create |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 8 | “asdf” / 1-char input produce full results | Client + API use `assessObjectiveQuality` / `assessExploreQuestion`; nonsense rejected before analysis |
| 9 | No map on /explore | `ExploreMap` with synthetic study area, result parcels, transit/school/flood layers by analysis type |
| 10 | Table/KPI inert | Row + map click selects area; evidence panel shows metrics, score breakdown, limitations |
| 11 | No methodology/evidence panel | Collapsible methodology (weights, datasets, steps, sort key) + per-selection evidence |
| 12 | No export | CSV + GeoJSON export of scratch findings |
| 13 | Convert drops state | Convert handoff carries question + top findings (existing-project picker deferred) |
| 14 | Refresh destroys state | `EXPLORE_SESSION_KEY` sessionStorage persists question + last result |
| 15 | Results don’t echo question | Findings card shows question text + investigated timestamp + analysis type |
| 16 | Limitations duplicated/malformed | `dedupeLimitations` + single-prefix dataset notes; upland+flood-mapping warning when top recs overlap incomplete coverage |

## P2 — Fixed (where cheap)

| # | Issue | Resolution |
|---|-------|------------|
| 17 | Query not URL-addressable | `?q=` read on load into textarea |
| 18 | Results below fold | `scrollIntoView` on findings section after investigate |
| 19 | Housing-centric KPIs for gap questions | Gap profiles emit gap_area_count, population_in_gap_areas, avg/median gap distance |
| 20 | Chip 1 identical to placeholder | Placeholder reworded; chips include flood example |
| 21 | Only 3 chips | Added flood exposure example chip |
| 22 | Top-15 truncation silent | “Showing top N of M areas” copy |

## P2 — Deferred

| # | Issue | Reason |
|---|-------|--------|
| 23 | Greeting timezone at wrong local hour | `plannerGreeting()` already locale-based; needs live repro beyond this pass |
| 24 | 390px header overlap | Responsive header layout pass — not Explore-specific |
| 25 | No error/retry if analysis fails | Needs shared async error boundary pattern across routes |

## Preserved

- Turf spatial engine
- Provenance chips / score breakdown semantics
- snake_case WebMCP tools (UI hidden unless `NEXT_PUBLIC_SHOW_WEBMCP_UI`)
- Synthetic geography (no OSM/SF tiles)
- Explore does not create a project on Investigate

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: `/explore` → transit gap question → map + gap KPIs → select row → methodology → export GeoJSON → Convert to planning project → `/new` shows prefilled objective + findings → create only after confirm.
