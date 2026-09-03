# Production Hardening Pass 26 — yield gap and branch compare

Live reference: https://urban-planning-copilot.onrender.com/

## Pass 26 live QA (P1)

| Issue | Symptom | Fix |
|-------|---------|-----|
| Yield gap | Decision showed “Housing target metrics unavailable” despite ~13-home top site and 2,000-home objective | `resolveHousingTarget` + `totalCapacityFromResult`; `computeYieldGap` always surfaces in Results/Decision when housing candidates exist |
| Flood-weighted branch | New branch kept identical 45/35/20 weights | `applyFloodWeightedWeights` on create (35% flood, persisted); UI notes ranking unchanged until analysis |
| Compare | Unanalyzed branches selectable; dead “Run analysis first” copy | Block unanalyzed selection; recovery buttons “Run analysis on {branch}” (navigate, no auto-run) |
| Copilot compare | “Compare scenarios” offered with only one analyzed branch | Suggestions/routing require ≥2 **analyzed** scenarios; otherwise “Run analysis on {branch}” |
| Branch switch | Active scenario changed silently after branch create | Toast + resume note: now viewing {branch}, analysis not run yet |
| Shortlist badge | Confusing on empty draft branch | Badge labels scenario name; hidden when no resolved pins in current results |

## Implementation

| Area | Change |
|------|--------|
| `housing-target.ts` | Resolve target from objective, project title, or raw text; derive capacity from aggregates or candidates |
| `results-display.ts` | `housingGoalSummary` never returns null when candidates + target exist |
| `yield-gap.ts` / `YieldGapBanner` | Always show housing yield panel (warning vs info tone) |
| `weights.ts` | `applyFloodWeightedWeights`, `isFloodWeightedBranchName` |
| `services.ts` | Flood-weighted branch applies shifted weights on create |
| `scenario-resolution.ts` | `scenarioHasComparableAnalysis` for Compare + copilot gating |
| `planner-query.ts` | `analyzedScenarioCount`, run-analysis suggestion, compare routing |
| `workspace-client.tsx` | Context/Results/Decision/Compare/branch toast/shortlist badge |
| `UrbanPlanningCopilot.tsx` | Pass analyzed scenario context to router |

No store rewrite. Pass 25 persist, filter bar, flood drill-down, and visual chrome unchanged. `invokePlanningTool` → `/api/mcp` unchanged.

## Verify

```bash
npm test
npm run build
```

Manual:

1. Housing project with 2,000-home target → Context and Results show target; Decision shows yield gap (top site vs top-N vs shortlist), not “metrics unavailable”.
2. “Create a Flood-weighted branch” → Priorities show ~35% flood (not 20%); banner says run analysis for new ranking.
3. Compare tab → cannot select unanalyzed branch; recovery links say “Run analysis on {name}”.
4. Copilot with one analyzed branch → no “Compare scenarios” chip; “Run analysis on {branch}” instead.
5. Create branch via copilot → toast “Now viewing {branch} — analysis not run yet”.
6. Empty draft branch → no shortlist badge; pinned sites show `Shortlist ({scenario}): N`.
