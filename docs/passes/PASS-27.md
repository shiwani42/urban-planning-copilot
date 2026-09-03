# Production Hardening Pass 27 — branch visibility and flood honesty

Live reference: https://urban-planning-copilot.onrender.com/

## P2 friction (live, post pass 26)

| Issue | Symptom | Fix |
|-------|---------|-----|
| Branch create view | Results/workspace jumped to unanalyzed draft; scenario picker buried in sidebar | Keep analyzed scenario active on branch create; header scenario `<select>` with “no results yet” label |
| Home project card | Second branch invisible on home | `scenarioCount` + `scenarioSummary` on list API; card shows `N scenarios: Baseline · Flood-weighted` |
| Flood score 100 | High resilience read as “no flood risk” with incomplete layer | `candidateFloodIncompleteCaveat` on Results rows and Evidence when coverage incomplete |
| Copilot after branch | Activity said run analysis but no one-click action | Activity entry `followUp` button: “Run analysis on {branch}” (`run_analysis` with branch `scenarioId`) |
| Results filters | No flood-risk or capacity filters | Client-side `floodRisk` band + min/max homes on existing filter bar |
| Workspace load | Generic “Connecting to project storage” for 8–10s | Phase copy names what is loading; elapsed seconds retained from pass 25 |

## Implementation

| Area | Change |
|------|--------|
| `services.ts` | Branch create keeps `activeScenarioId` on source; resume note says still viewing analyzed branch |
| `workspace-client.tsx` | Header scenario switcher; branch-create toast; flood caveat in Results/Evidence |
| `types.ts` / `listProjects` | `scenarioCount`, `scenarioSummary` on home cards |
| `flood-coverage.ts` | `candidateFloodIncompleteCaveat` |
| `results-filter.ts` | `floodRisk`, `capacityMin`/`capacityMax` filters |
| `copilot-activity.ts` | Optional `followUp` action on activity entries |
| `UrbanPlanningCopilot.tsx` | One-click “Run analysis on {branch}” after `create_scenario_branch` |
| `planner-query.ts` / `server-handlers.ts` | Branch-create copy reflects staying on analyzed scenario; returns `createdScenarioId` |
| `workspace-hooks.tsx` | Specific load-phase copy (storage, scenarios, datasets, map cache) |

Pass 26 yield gap, flood-weighted weights, Compare gating, and persist recovery unchanged. No store rewrite or new datasets.

## Verify

```bash
npm test
npm run build
```

Manual:

1. Run analysis on Baseline → create Flood-weighted branch → workspace stays on Baseline results; header switcher lists both branches.
2. Switch to Flood-weighted in header → “No results yet” badge; sidebar scenario list still works.
3. Home card for multi-branch project shows scenario count and names.
4. Candidate with flood resilience ≥70 under incomplete flood layer → caveat in Results label and Evidence.
5. Copilot creates branch → Agent activity shows “Run analysis on {name}” button that runs analysis without switching view.
6. Results filter bar → flood-risk band and min/max homes narrow the table client-side.
7. Workspace load → phase text names storage/scenarios/datasets; elapsed seconds shown.
