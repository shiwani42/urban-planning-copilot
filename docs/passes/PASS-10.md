# Production Hardening Pass 10

Scope: WebMCP agent loop — persistence across reload, live UI sync after tool mutations, structured tool errors, validation hardening, and **missing product capabilities** that blocked planner/agent co-browsing (workspace + WebMCP tools + live UI sync only).

Live reference: https://urban-planning-copilot.onrender.com/

## Bug fixes (P0)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Refresh/direct URL loses projects | `reloadStoreFromDisk()` on reads; server file store remains source of truth |
| 2 | WebMCP mutations do not update open UI | `upc:workspace-mutated` event after mutating tools; workspace + home listen and refetch |
| 3 | `exclude_map_area` applies then errors | Pre-validate label/geometry; no store write until validation passes |
| 4 | Opaque tool failures | `ToolError` with `code`, `field`, `message` |
| 5 | `set_planning_objective` wipes requirements | Rejects empty/destructive text; blocks constraint drops unless `confirmConstraintChange:true` |
| 6 | Human-gated tools self-cancel | Returns `{ status: "pending_planner", ... }`; workspace banner until Approve/Reject; never throws `"cancelled by planner"` |
| 7 | `get_workspace` invents missing projects | `requireProject()` reloads from disk; fails `NOT_FOUND` when absent |
| 8 | `run_analysis` false-negative after success | `getAnalysisRunStatus()` recovery; returns `running` / `completed` instead of throwing when results persisted |
| 9 | `start_planning_project` does not open workspace | Returns `workspaceUrl`; browser navigates via `window.location.assign` |
| 10 | Stale banner hidden after map/constraint edits | `criteriaStale` mutation hint + immediate “Results stale — recalculate” chip before refetch |

## New capabilities (must-build)

| # | Capability | Implementation |
|---|------------|----------------|
| 1 | **Live map follow** (`set_map_view`) | `MapViewportSync` + `mapViewport` on mutation events; map flies to agent pan/zoom without F5 |
| 2 | **Context defaults** | Browser injects open `projectId`/`scenarioId`; server merges `context` from `/api/mcp`; schemas document optional ids |
| 3 | **Pending planner loop** | `pending_planner` payload + client queue (`planner-pending.ts`) + “Agent awaiting planner” banner; Approve re-invokes with `confirmed:true` |
| 4 | **Project bootstrap** | `start_planning_project` navigates tab + home list refetches on mutation |
| 5 | **Stale UX** | Chip + Recalculate button update immediately via `criteriaStaleHint` and mutation bus |
| 6 | **Objective constraint gate** | `assessObjectiveConstraintImpact()` + `CONSTRAINT_CHANGE` error listing dropped flood/transit constraints |
| 7 | **Agent entry point** | `smart_toy` icon scrolls/focuses Agent activity panel (was decorative) |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 6 | `set_transit_threshold` accepts nonsense | Rejects `< 1` and `> 50000` meters |
| 7 | `set_priority_weights` silent on unknown keys | Errors with `UNKNOWN_FIELD` |
| 8 | `compare_scenarios` with incomplete analysis | Requires `>= 2` ids; returns `status: incomplete` |
| 9 | `start_planning_project` missing on home | Home list refetches on workspace mutation events |
| 10 | Invalid proposal action staged | `assertProposalAction` at `stage_proposal` time |
| 11 | `select_candidate` succeeds for missing id | Validates candidate exists |
| 12 | `verify_operation` ambiguous | `status`: `nothing_to_verify` \| `pending` \| `verified` \| `failed` |
| 13 | No map viewport tool | `set_map_view` with live follow |
| 14 | Human-review banner overlaps nav | Banner below header; revision hash stripped from titles |
| 15 | Carto “API KEY REQUIRED” without key | Wikimedia OSM fallback when `NEXT_PUBLIC_CARTO_API_KEY` unset |
| 16 | `generate_report` / sensitive tools via WebMCP | `pending_planner` flow + structured errors |

## P2 — Fixed (cheap)

| # | Issue | Resolution |
|---|-------|------------|
| 17 | JSON string tool arguments | `parseToolArguments` accepts object or JSON string |
| 18 | Agent map edits attribution | Activity summary uses “AI agent” for `createdBy: agent` |
| 19 | Legend vs layers (parks) | Parks legend entry when parks layer visible |
| 20 | Geography banner mismatch | Map banner uses `project.geographyLabel` |

## Key files

- `src/lib/webmcp/server-handlers.ts` — tool execution, context merge, scenario defaults
- `src/lib/webmcp/register-browser.ts` — browser context injection, pending planner registration
- `src/lib/webmcp/browser-context.ts` — live tab context for tool defaults
- `src/lib/webmcp/tool-context.ts` — server-side context merge + scenario resolution
- `src/lib/planner-pending.ts` — client pending planner queue + banner events
- `src/lib/domain/human-gated-tools.ts` — `pending_planner` gate (includes `generate_report`)
- `src/lib/workspace-sync.ts` — mutation bus (`criteriaStale`, `mapViewport`)
- `src/components/PlanningMap.tsx` — `MapViewportSync` live follow
- `src/app/workspace/[projectId]/workspace-client.tsx` — pending banner, stale chip, agent entry

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: open workspace → agent calls `get_workspace` without ids (defaults apply) → `set_map_view` pans map live → `exclude_map_area` shows stale chip → `approve_scenario` returns `pending_planner` → planner clicks Approve → decision completes → `generate_report` same flow.
