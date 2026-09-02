# Production Hardening Pass 18 — compare diffs and target gap

Live reference: https://urban-planning-copilot.onrender.com/

## Problem

Live Compare of **Baseline** vs **Flood-weighted** on Pass 17 compact persist showed **identical** metrics (572 areas, 1098 homes, same top 3) because weights and constraints were unchanged after duplicate. The table looked like a valid diff but offered no explanation — users could not tell whether Compare was broken or inputs were the same.

Persistence and the analysis store are unchanged in this pass.

## Must-build

| Area | Change |
|------|--------|
| Compare — inputs diff | Panel at top for assumptions, weights, and constraints. Identical inputs show: *"These scenarios use the same weights and constraints — results will match until you change one."* |
| Compare — metric deltas | Per-metric **Δ** column for eligible count, capacity, housing target %, target gap, transit, flood resilience, and related rows |
| Compare — housing target | Target vs units with **% of stated goal** (e.g. 1098/2000 = 55%), gap, single-parcel vs combined shortlist notes |
| Compare — rank score | Always-visible comparability warning plus one-line score definition (weighted sum of listed factors) |
| Duplicate flow | Lands on new scenario in Workspace; **Priorities** panel highlighted — no silent re-run with identical inputs |
| Compare empty state | Dashed placeholder panels instead of an empty/broken-looking table |

## P1 (included)

| Area | Change |
|------|--------|
| Compare table | Sort rows by metric name or largest delta |
| N/A metrics | Em-dash cells replaced with *"not in this analysis"* |
| Decision / Report | `housingGoalSummary` shows same **% of goal** as Compare |

## Implementation

- `src/lib/domain/compare.ts` — input diff, enriched rows, table builder, housing target progress
- `src/lib/domain/services.ts` — `compareScenarios` returns `inputsDiff`, `tableRows`, `housingTargets`, `metricsIdentical`, `rankScoreNote`
- `src/lib/domain/results-display.ts` — housing goal copy includes percent of target
- `src/app/workspace/[projectId]/workspace-client.tsx` — Compare UI, shared `CompareMetricsTable`, duplicate → weights highlight

No PDF, shapefile, or persistence rewrite.

## Tests

`src/lib/domain/compare.test.ts`:

- Identical vs changed weight diff (flood weight)
- Housing target percent and shortlist notes
- Delta column on capacity and flood metrics
- Identical metrics when same analysis output is compared twice

## Verify

```bash
npm test
npm run build
```

Manual:

1. Duplicate scenario → Workspace tab, Priorities panel highlighted; toast prompts weight change before analysis.
2. Compare two scenarios with **same** weights → inputs diff message + identical metrics banner.
3. Change flood weight on branch, re-run analysis → Compare shows weight diff and non-zero deltas.
4. Decision and Report show `55% of 2,000-home goal` style copy when below target.
