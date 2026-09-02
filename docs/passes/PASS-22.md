# Production Hardening Pass 22 — in-app copilot and keyboard

Live reference: https://urban-planning-copilot.onrender.com/

## Pass 22 live walk (P0)

| Issue | Symptom | Root cause |
|-------|---------|------------|
| Copilot UX | “Ask nekuda” / nekuda Workbench opened instead of in-app answers | No first-party planner chat; browser extension became the default agent surface |
| Agent activity | No planner tool progress in workspace | Tool calls only via external workbench |
| Home keyboard | Rename/delete hover-only; tab order skipped New project | Actions hidden until hover; no skip links |
| Delete empty state | “Server lost your work” after intentional delete | Recovery banner treated intentional empty list like data loss |
| Store migrate | `projectCount 0` after deploy until new create | Missing fields / bad parse could persist empty projects over readable store |
| Map PNG | Toast without file (pass 21 partial) | Verify async download path still wired |

## Must-build

| Area | Change |
|------|--------|
| In-app copilot | `UrbanPlanningCopilot` panel — labeled **Urban Planning Copilot** — freeform ask, grouped tools (Map, Analysis, Scenarios, Reports), suggestions, progress/error/result in Agent activity |
| Tool execution | Calls `/api/mcp` via `invokePlanningTool`; workspace refreshes on mutation; nekuda Workbench kept for debug (Alt+K) |
| Suggestions | Home suggestions do not assume an open project; workspace suggestions are project-scoped |
| Keyboard | Project cards: rename + menu on focus; skip links to main content and New project |
| Delete copy | “You deleted the last project” vs server-loss recovery banner |
| Store upgrade | `normalizeStoreShape` fills missing fields; refuse load when normalization would drop on-disk projects |
| PNG export | Toast only after `captureMapPng` returns true (pass 21 behavior retained) |

## Key files

- `src/components/UrbanPlanningCopilot.tsx` — planner UI + activity feed
- `src/lib/copilot/planner-query.ts` — query routing and suggestions
- `src/lib/copilot/tool-groups.ts` — tool grouping
- `src/lib/copilot/copilot-activity.ts` — client activity bus
- `src/lib/webmcp/register-browser.ts` — exported `invokePlanningTool`
- `src/lib/domain/store-shape.ts` — in-place store normalization + persist guard helper
- `src/lib/domain/store.ts` — parse normalization + empty-project persist refusal
- `src/app/page.tsx` — home copilot, keyboard, delete empty state
- `src/app/workspace/[projectId]/workspace-client.tsx` — workspace copilot embed
- `src/components/AppHeader.tsx` — skip links + `id="new-project-link"`

## Verify

```bash
npm test
npm run build
```

Manual:

1. Home → Urban Planning Copilot → “list datasets” runs in-panel (not nekuda).
2. Open workspace → Ask “run analysis” / use grouped tools → Copilot tool runs appear in Agent activity.
3. Tab to project card → Rename and menu buttons reachable without hover.
4. Delete last project → “You deleted the last project” (not server-loss banner).
5. Export PNG → file in Downloads; failure shows retry message only.

No store rewrite. nekuda WebMCP Workbench remains available as a developer debug extension.
