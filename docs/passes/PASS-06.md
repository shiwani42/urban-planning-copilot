# Production Hardening Pass 06

Scope: Evidence, provenance, and activity inspectability — timestamps, deep links, dataset lineage, and audit trail polish.

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Activity timestamps wrong TZ / report body disagrees with list | Planner-facing timestamps use `Asia/Kolkata` (IST) consistently; sidebar activity uses full datetime |
| 2 | Provenance chips (`ds-parcels` etc.) dead text | `DatasetRefChip` links to Evidence; analysis plan dataset chips are clickable |
| 3 | Activity event details `OUTPUTS={}` | Richer `inputs`/`outputs` on analysis events (scenario, dataset versions, metrics); detail panel always shows both sections |
| 4 | Footer says 3 DATASETS while catalog lists 6 | Footer counts enabled datasets for the active scenario, not analysis-plan step union |
| 5 | Datasets cannot be shown on map from Evidence | **Show on map** toggles layer visibility and returns to Workspace map |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 6 | Tabs not URL-addressable (404 on `/workspace/id/evidence`) | `/workspace/[projectId]/[tab]` routes with `router.replace` sync |
| 7 | Clicking candidate on Branch 2 switched scenario to Baseline | `selectedCandidateScenarioId` scopes selection; cleared on scenario switch |
| 8 | Deduplicate limitation text | `dedupeLimitations()` in format + applied to results/candidates/decision |
| 9 | Limitations only inherited flood dataset notes | `collectDatasetLimitations()` merges all enabled dataset limitations |
| 10 | Ambiguous identical exclusion names in activity | Geographic activity summaries include short selection id suffix |
| 11 | Activity filters missing | Actor, scenario, and search filters on Activity tab |
| 12 | Activity events not attributed to scenario | `scenarioId` on report/data events; scenario name in list + detail |
| 13 | Decision tab contradicts itself | Separate states: no results / stale / ready; buttons only when fresh analysis exists |
| 14 | Reports list hides other-scenario reports | **Reports for other scenarios** section with explicit note |
| 15 | Report compare table empty em-dashes | `compareScenarioMetrics` uses rank-sorted top candidate; missing metrics show `—` |
| 16 | `/data` Disable/Mark outdated vs workspace Evidence | Data page labeled global catalog; Evidence reflects catalog state; stale marks invalidate results |
| 17 | Dataset timestamps are workspace-created | `dataVintage` on datasets; UI shows vintage + catalog sync time |

## Preserved

- Turf spatial engine
- snake_case WebMCP tools
- Synthetic geography (no OSM/Carto tiles)

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: open `/workspace/{id}/evidence` → Show on map → verify layer visible → Activity tab filters → generate report → compare table shows numeric metrics → `/data` mark flood outdated → Evidence shows outdated + results stale.
