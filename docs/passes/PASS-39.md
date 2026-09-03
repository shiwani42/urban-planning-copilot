# PASS-39 — Planner handoffs (Pass 38 deferred items)

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Ship Pass 38 deferred planner handoffs and one home-dashboard deep-link fix. No `store-postgres.ts` changes, no Civic token restyle, no secrets.

## Shipped

### Copilot `compare_scenarios` → Compare tab
- `workspace-sync` emits `openTab: "compare"` with `compareScenarioIds` and full compare payload after MCP/copilot compare.
- Workspace listens and switches to Compare, applies table/insights state (not feed-only).
- Compare tab button reuses shared `applyCompareFromPayload` helper.

### Explore → workspace (server project)
- **Convert to planning project** POSTs `/api/projects` with Explore objective + scratch summary (`fromExplore: true`).
- Verifies `GET /api/projects/:id` before navigation; lands in `/workspace/:id` (no sessionStorage-only dead end).
- `createProject` logs `convert_from_explore` activity and sets resume note for converted projects.

### Home deep links
- Continue cards and project list open `/workspace/:id?scenarioId=…` using `activeScenarioId`.
- Recent Analyses rows include `scenarioId` and open the analyzed branch.
- Continue scenario chip uses **active** branch name only (not approved-scenario fallback).

### Copilot branch context
- After `create_scenario_branch`, browser WebMCP context `scenarioId` updates to the new active branch so pin/analysis tools target the branch.

## Skipped (verified OK)

| Area | Notes |
|------|--------|
| Report export / print | Markdown download + preview export implemented; no stub handler found |
| Exclude from copilot NL | Still routes to map-draw guidance (by design — needs coordinates) |
| Pin / shortlist via MCP | `add_to_shortlist` wired; stale `scenarioId` fixed via branch context update |
| `/new` manual create | Still available; Explore convert bypasses form but uses same server create path |

## Verification

```bash
npm test
npm run build
```

Manual: Copilot “compare scenarios” → Compare tab opens with selected branches; Explore investigate → Convert → workspace created on server; Home Continue opens active branch; Recent Analyses row opens matching scenario.
