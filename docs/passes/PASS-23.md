# Production Hardening Pass 23 — copilot mutations

Live reference: https://urban-planning-copilot.onrender.com/

## Pass 23 live walk (must-fix)

| Issue | Symptom | Root cause |
|-------|---------|------------|
| Pin / shortlist routing | “pin top site” called `list_shortlist` and returned count 0 | Broad `\bshortlist\b` pattern matched before mutation intent |
| Branch / duplicate | No copilot path to duplicate or flood-weighted branch | Router had no `create_scenario_branch` patterns |
| Compare suggestion | Compare offered with only one scenario | Static workspace suggestions always included compare |
| Activity feed | Raw JSON truncated in copilot activity | `summarizeToolResult` fell back to `JSON.stringify` |
| Ask button | “…” with no progress copy | Submit button only swapped label to ellipsis |
| Workspace load | 10–15s white screen on slow store read | Minimal centered spinner instead of layout skeleton |

## Fixes

| Area | Change |
|------|--------|
| Natural language router | Pin/star/shortlist-top → `add_to_shortlist` (top candidate when unspecified); duplicate/branch/flood-weighted → `create_scenario_branch` with extracted name; compare → `compare_scenarios` when ≥2 scenarios else human guidance; exclude → map-draw instructions (no fake list) |
| Copilot activity | Human sentences per tool (`Pinned Mission — Blk/Lot … to the shortlist`); inline status line + “Working…” on Ask; no JSON dumps in feed |
| Suggestions | Single-scenario workspaces offer “Create a Flood-weighted branch”; compare only when ≥2 scenarios |
| Live refresh | Mutations still go through `invokePlanningTool` → `/api/mcp` → `upc:workspace-mutated`; copilot `onToolComplete` refreshes workspace |
| Home cards | `shortlistCount` on active scenario surfaced when non-zero |
| Workspace load | Full header/map/inspector skeleton with progress copy during fetch |

## Key files

- `src/lib/copilot/planner-query.ts` — routing, suggestions, human summaries
- `src/lib/copilot/planner-query.test.ts` — pin, branch, compare, exclude regressions
- `src/components/UrbanPlanningCopilot.tsx` — context props, status UX, mutation arg resolution
- `src/app/workspace/[projectId]/workspace-client.tsx` — skeleton loader, copilot context
- `src/app/workspace/[projectId]/page.tsx` — Suspense fallback with progress copy
- `src/lib/domain/services.ts` — `shortlistCount` on project list items
- `src/app/page.tsx` — home card shortlist badge

## Verify

```bash
npm test
npm run build
```

Manual:

1. Open workspace with analysis → Ask “pin the top site” → shortlist updates without reload; activity shows human pin sentence.
2. Ask “create a flood-weighted branch” → new scenario appears; Ask “compare scenarios” with one branch → guidance to branch first.
3. Ask “exclude this area” → map-draw instructions (no shortlist list).
4. Slow workspace open → skeleton layout with “Loading workspace…” instead of blank white.
5. Home project card shows shortlist count when pins exist on the active scenario.

No store rewrite. `invokePlanningTool` → `/api/mcp` unchanged. nekuda Workbench remains debug-only (Alt+K).
