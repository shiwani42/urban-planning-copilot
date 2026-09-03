# Production hardening pass 32: planner UI polish

Live reference: https://urban-planning-copilot.onrender.com/

## Purpose

Late UI polish for planner delight — hierarchy, density, and calm empty states without changing analysis math, store shape, or persist behavior. Refines the existing teal / map-first language; not a rebrand.

## Goals addressed

| Area | Change |
|------|--------|
| Home | Continue vs All other projects (no duplicate cards); one-line `projectStatusLine` for analysis / branches / shortlist; calmer list rows; search and + New unchanged |
| Workspace chrome | Two-row header: full project name + scenario switcher; scrollable tab row; map remains hero; results drawer taller with internal scroll |
| Copilot rail | Narrower rail; subdued suggestion chips; Working… on running tools; composer placeholder names real commands |
| Results | Readable filter bar labels; yield-gap and flood as calm note banners; Pin column labeled; sticky table header |
| Decision | No Approve on empty/stale evidence — recovery CTA to Workspace; actions only when analysis is fresh |
| Compare | Empty state offers Run analysis recovery buttons |
| Report | Generate / Export Markdown primary in header strip |
| Density | `focus-ring` utility; less competing teal on tabs and banners |
| Loading | Workspace skeleton retains named phase + elapsed (pass 25/27); no white screen |

## Implementation

| Area | Files |
|------|-------|
| Project list status | `src/lib/project-status.ts`, `src/app/page.tsx` |
| Workspace chrome / tabs / results / decision / compare / report | `src/app/workspace/[projectId]/workspace-client.tsx` |
| Copilot rail | `src/components/UrbanPlanningCopilot.tsx` |
| Global focus + scroll | `src/app/globals.css` |
| Header | `src/components/AppHeader.tsx` |

Out of scope (unchanged): persist / `DATA_DIR`, Nekuda as primary, new datasets, store rewrite, analysis math.

## Verify

```bash
npm test
npm run build
```

Manual:

1. Home — one project in Continue only appears there; All other projects excludes Continue rows; status is one line (not three teal boxes).
2. Workspace — project name not truncated; scenario switcher in header; tabs scroll horizontally on narrow widths.
3. Results — flood/yield banners are neutral notes; filter fields have labels; table scrolls inside drawer.
4. Decision without analysis — Run analysis in Workspace CTA; no Approve row.
5. Compare with one analyzed branch — empty state shows Run analysis on {branch}.
6. Report — Generate report is the prominent primary action.
7. Copilot — suggestion chips small; running tool shows Working… in activity.
