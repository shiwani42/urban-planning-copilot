# Production Hardening Pass 18 — compare diffs and target gap

Live reference: https://urban-planning-copilot.onrender.com/

## Problems

### Compare looked broken when inputs matched

Live Compare of **Baseline** vs **Flood-weighted** on Pass 17 compact persist showed **identical** metrics (572 areas, 1098 homes, same top 3) because weights and constraints were unchanged after duplicate. The table looked like a valid diff but offered no explanation.

### Decision tab crashed on compact-persist projects

Decision on Pass 17 compact persist crashed client-side twice; after the crash the workspace showed **Project not found** for a valid project id.

**Cause:** Pass 17 compact persist strips per-candidate `provenance` (and may omit `limitations` / `aggregateMetrics` on reload). Decision and Report still assumed those fields existed — e.g. `result.aggregateMetrics.find(...)`, `selected.provenance.scoreBreakdown`, and `limitations.slice(...)`.

Persistence store format is unchanged in this pass (no rewrite).

## Must-build (Compare)

| Area | Change |
|------|--------|
| Compare — inputs diff | Panel at top for assumptions, weights, and constraints. Identical inputs show: *"These scenarios use the same weights and constraints — results will match until you change one."* |
| Compare — metric deltas | Per-metric **Δ** column for eligible count, capacity, housing target %, target gap, transit, flood resilience, and related rows |
| Compare — housing target | Target vs units with **% of stated goal** (e.g. 1098/2000 = 55%), gap, single-parcel vs combined shortlist notes |
| Compare — rank score | Always-visible comparability warning plus one-line score definition (weighted sum of listed factors) |
| Duplicate flow | Lands on new scenario in Workspace; **Priorities** panel highlighted — no silent re-run with identical inputs |
| Compare empty state | Dashed placeholder panels instead of an empty/broken-looking table |

## Must-build (Decision / Report)

| Area | Change |
|------|--------|
| `analysis-display.ts` | Safe accessors for limitations, aggregate metrics, candidate metrics/provenance |
| `store-persistence.ts` | Defensive hydrate when `metrics` / `limitations` / `aggregateMetrics` missing; normalize after hydrate |
| `workspace-client.tsx` | Decision + Report use safe accessors; `TabErrorBoundary` catches render errors without unloading project |
| `workspace-hooks.tsx` | Refresh failures after mutations keep last good workspace snapshot (no false “project not found”) |
| `results-display.ts` | Results columns and evidence metrics tolerate missing `candidate.metrics` |

## P1 (included)

| Area | Change |
|------|--------|
| Compare table | Sort rows by metric name or largest delta |
| N/A metrics | Em-dash cells replaced with *"not in this analysis"* |
| Decision / Report | `housingGoalSummary` shows same **% of goal** as Compare |

## Implementation

- `src/lib/domain/compare.ts` — input diff, enriched rows, table builder, housing target progress
- `src/lib/domain/analysis-display.ts` — compact-persist safe normalization for Decision/Report/Results
- `src/lib/domain/services.ts` — `compareScenarios` returns `inputsDiff`, `tableRows`, `housingTargets`, `metricsIdentical`, `rankScoreNote`
- `src/lib/domain/results-display.ts` — housing goal copy includes percent of target; safe metric reads
- `src/app/workspace/[projectId]/workspace-client.tsx` — Compare UI, shared `CompareMetricsTable`, duplicate → weights highlight, tab error boundaries
- `src/components/workspace-hooks.tsx` — preserve workspace on non-initial refresh failure

No PDF, shapefile, or persistence rewrite.

## Tests

`src/lib/domain/compare.test.ts`:

- Identical vs changed weight diff (flood weight)
- Housing target percent and shortlist notes
- Delta column on capacity and flood metrics
- Identical metrics when same analysis output is compared twice

`src/lib/domain/analysis-display.test.ts`:

- Missing `limitations` / `aggregateMetrics` on analysis results
- Provenance rebuilt from result limitations after compact persist
- Normalized compact candidates without metrics

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
5. Open Decision on a Pass 17 compact-persist project with analyzed scenario → tab loads; limitations/provenance show result-level fallbacks instead of crashing.
