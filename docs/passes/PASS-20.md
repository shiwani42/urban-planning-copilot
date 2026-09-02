# Production Hardening Pass 20

Scope: Home project status, workspace deep links, report staleness after decisions, plan-scoped dataset invalidation, and data-catalog error surfacing.

Live reference: https://urban-planning-copilot.onrender.com/

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Home “Action required / Review results” when another scenario is already Approved | `listProjects` returns structured status: `approvedScenarioName`, `activeScenarioNote`, and `actionRequiredLabel`. Cards show approval and active-branch status; sidebar skips review prompts when a non-stale approval exists elsewhere. `runAnalysis` preserves decision-aware `resumeNoteForScenario`. |
| 2 | `?initialTab=activity` and `?initialTab=report` ignored | `resolveWorkspaceTab` shared helper; workspace pages read `searchParams.initialTab`; client honors query on load. Path tabs (`/workspace/{id}/evidence`) unchanged from pass 6. |
| 3 | Reports still say “No human decision recorded” after decision | `recordDecision` marks matching report snapshots `stale` with reason; Report tab shows stale banner and history labels; regenerated reports include the decision section. |
| 4 | Reports list all enabled datasets | Report `Datasets` section lists analysis-plan-used datasets; enabled-but-unused sets get an explicit “not in plan” note. |
| 5 | Unrelated dataset outdated invalidates every scenario | `scenarioUsesDataset` / `datasetIdsUsedByAnalysisPlan` scope `markDatasetStale`, disable, and feature-patch invalidation to scenarios whose plan references the dataset. |
| 6 | Clearing outdated flag silently looks broken | Clearing catalog flag no longer re-stamps results; activity log and `/data` copy explain results stay stale until recalculate. |
| 7 | Data-catalog mutation errors swallowed | `/data` PATCH checks `res.ok`, surfaces errors inline, and disables buttons while busy. |

## P2 — Included

| Issue | Resolution |
|-------|------------|
| Search/filter on `/data` | Dataset name/kind/source/coverage search |
| Disable confirm | Confirm dialog before disabling a catalog dataset |
| Activity default event | Activity tab auto-selects the latest event |
| Keyboard/focus for project actions | Home card actions use `group-focus-within` (pass 7 pattern retained) |

## Key files

- `src/lib/domain/services.ts` — project list summary, report staleness, plan-scoped datasets & invalidation
- `src/lib/domain/types.ts` — `ProjectListItem` status fields, `Report.stale`
- `src/lib/workspace-tabs.ts` — tab resolution for query + path deep links
- `src/app/page.tsx` — dual status on project cards, structured action required
- `src/app/workspace/[projectId]/page.tsx`, `[tab]/page.tsx` — `initialTab` query support
- `src/app/workspace/[projectId]/workspace-client.tsx` — report stale UI, activity default selection
- `src/app/data/page.tsx` — search, errors, disable confirm, clear-outdated guidance
- `src/lib/domain/pass-20.test.ts`, `src/lib/workspace-tabs.test.ts` — regression tests

## Verification

```bash
npm test
npm run build
```

Manual walk:

1. Approve Baseline, switch to undecided Branch B with results → Home shows **Approved: Baseline** plus active-branch note; no false “Review results” in Action required.
2. Open `/workspace/{id}?initialTab=activity` and `?initialTab=report` → correct tabs; `/workspace/{id}/evidence` still works.
3. Generate report → record decision → existing report shows stale banner; **Update report** includes approval.
4. `/data` mark an unused dataset outdated → only scenarios whose plan uses it go stale; clear flag → UI explains recalculate required.

## Out of scope

Store persistence rework (healthy on live), merge.
