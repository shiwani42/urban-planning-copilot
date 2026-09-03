# PASS-44 — Path tab regression fixes (post Pass 43)

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Pass 43 moved workspace tabs to path URLs (`/workspace/:id/results`, etc.) and full-page Results. Pass 44 fixes regressions in copilot compare handoff, home deep links, WebMCP tool aliases, keyboard tab shortcuts, and analysis-complete navigation — without touching `store-postgres.ts` or persistence.

## Shipped

### Compare tab survives navigation
- `WorkspaceClient` lives in `/workspace/[projectId]/layout.tsx` so tab path changes no longer remount state.
- `compare_scenarios` navigates to `/workspace/:id/compare?compareScenarioIds=…` with the requested branch ids.
- Compare selection rehydrates from `compareScenarioIds` query param on load/deep link.

### Home / scenario deep links
- `?scenarioId=` is preserved when switching tabs via `workspaceTabUrl`.
- Continue / Recent Analyses links still activate the target scenario on any workspace path.

### WebMCP aliases (no UNKNOWN_TOOL 404)
- `list_projects` — server catalog list.
- `load_project` → `get_workspace`.
- `exclude_from_selection` → `exclude_features`.
- Aliases register in browser `document.modelContext` alongside canonical tools.

### Keyboard + legacy `?tab=`
- Alt+1 … Alt+7 switch tabs using path navigation (`WORKSPACE_TAB_KEYBOARD_SHORTCUTS`).
- Legacy `?tab=` / `?initialTab=` on `/workspace/:id` canonicalize to path URLs.

### Analysis complete → Results page
- `run_analysis` mutation emits `openTab: "results"`.
- **View results** closes the map drawer and opens the full-page Results panel (`layout="page"`).

## Verification

```bash
npm test
npm run build
```

Manual: Copilot “compare scenarios” → Compare tab with selected branches in URL; Home Continue with `?scenarioId=` selects branch; Alt+2 opens Results; WebMCP `list_projects` / `load_project` succeed on `/workspace/:id/results`; analysis-complete **View results** shows candidate table page.
