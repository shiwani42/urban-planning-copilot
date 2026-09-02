# Production Hardening Pass 24 — results filter and yield gap

Live reference: https://urban-planning-copilot.onrender.com/

## Pass 24 live walk (planner friction)

| Issue | Symptom | Root cause |
|-------|---------|------------|
| Results list | 572 candidates with no search/filter | Results drawer hard-capped top 40 with no filter UI |
| Yield gap | 600-home objective vs ~13-unit top site invisible | Only aggregate shortfall badge; no target vs shortlist vs top-N |
| Flood warning | Incomplete coverage + 698 exclusions, no drill-down | Static alert string with no expandable detail |
| Manual pin | Tiny unlabeled icon | Pin column existed but no undo feedback |
| Map exclusion | Polygon flow hidden behind icon-only control | Draw toolbar not discoverable from inspector |
| Selection toast | “Selection updated” after pin/reopen | Banner fired whenever `result.id` was first seen |
| Copilot hints | Supported NL commands not obvious | Generic placeholder; limited suggestion chips |
| Home status | “Analysis complete” after shortlist changes | `resumeNoteForScenario` ignored shortlist count |

## Fixes

| Area | Change |
|------|--------|
| Results filter | Client-side filter bar: neighborhood, score band, shortlisted-only, text search on address/blk-lot; shows “X of Y” count on full candidate list |
| Yield gap | `computeYieldGap` surfaces target vs top site vs top-N combined vs shortlist in Results and Decision when housing intent cannot be met by one parcel |
| Flood drill-down | Expandable flood alert: incomplete coverage reason, exclusion funnel, sample excluded parcels, link to Evidence flood layer |
| Pin / Unpin | Labeled Pin/Unpin buttons retained; brief undo toast on pin and unpin (no confirm modal) |
| Map exclusion | Labeled “Exclude area” map control + Constraints panel “Exclude this area” with one-line draw hint (existing polygon flow) |
| Selection banner | Only when analysis `result.id` changes after a prior result (not on first load, pin, or reopen) |
| Copilot discoverability | Placeholder command hints; chips for pin top site, exclude area, run analysis, branch/compare |
| Home cards | `resumeNoteForScenario` appends “N shortlisted” when pins exist (badge unchanged from pass 23) |

## Key files

- `src/lib/domain/results-filter.ts` — client-side candidate filtering
- `src/lib/domain/yield-gap.ts` — target vs shortlist vs top-N capacity
- `src/lib/domain/flood-coverage.ts` — expandable flood exclusion detail
- `src/app/workspace/[projectId]/workspace-client.tsx` — filter UI, yield gap, flood alert, pin undo, exclusion controls
- `src/lib/copilot/planner-query.ts` — command hints and suggestion chips
- `src/components/UrbanPlanningCopilot.tsx` — placeholder and exclude-area chip routing
- `src/lib/domain/services.ts` — home status line with shortlist count

## Verify

```bash
npm test
npm run build
```

Manual:

1. Open workspace with housing analysis → Results filter: search blk-lot, filter neighborhood, toggle shortlisted-only — list updates instantly with count.
2. With 600-home target and low top-site capacity → yield gap warning in Results and Decision.
3. Expand flood warning → see coverage reason, exclusion counts, sample parcels, Evidence link.
4. Pin a site → toast with Undo; Unpin → undo restores pin.
5. Click “Exclude area” on map or Constraints → polygon draw starts with hint.
6. Reopen workspace or pin site → no “Selection updated for new results” unless analysis re-ran.
7. Copilot shows command hints; chips include pin top site and exclude area.
8. Home card status shows “N shortlisted” when pins exist.

No store rewrite. Pass 23 copilot routing unchanged.
