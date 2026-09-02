# Production Hardening Pass 07

Scope: Home / project list UX — persistence is solid; polish list management, recency, search, loading, and greeting.

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | No delete project path | `DELETE /api/projects/[projectId]` + card menu Delete with confirm dialog; cascades scenarios, analyses, reports |
| 2 | No rename project path | `PATCH rename_project` + inline rename on home cards; min 2 chars; duplicate blocked |
| 3 | Duplicate project names silent | Amber warning on `/new` while typing; server `duplicateNameWarning` on create (non-blocking) |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 4 | All projects unsorted in UI | API `listProjects()` returns `updatedAt` desc; home All grid preserves order |
| 5 | Continue shows same set as All | **Continue** = top 3 by `lastOpenedAt` (fallback `updatedAt`); **All projects** lists full set |
| 6 | Continue rail clipped at viewport edge | Horizontal scroll with `-mx-section-padding px-section-padding scroll-px-section-padding` |
| 7 | No project search | Search input filters name, geography, resume note |
| 8 | No last-opened time | `record_open` on workspace load; cards show **Opened** / **Updated** relative time |
| 9 | Bare loading / no retry on list failure | Skeleton cards for Continue + All; error banner with **Retry** |
| 10 | Greeting pinned to server timezone on SSR | `PlannerGreeting` client component uses local hour after mount |
| 11 | `/new` draft lost on refresh | Existing `sessionStorage` draft (`upc-new-project-draft`) retained + verified |
| 12 | Min 2-char name only client-side | Server `assertProjectName()` on create/rename |

## P2 — Fixed (where cheap)

| # | Issue | Resolution |
|---|-------|------------|
| 13 | No jump from Continue to full list | **View all projects** scrolls to `#all-projects` when >3 projects |
| 14 | Search with zero matches opaque | Empty-state copy + **Clear search** |
| 15 | Rename/delete only on hover | Actions menu always visible on small screens; hover on md+ |

## Preserved

- Turf spatial engine
- snake_case WebMCP tools (UI hidden unless `NEXT_PUBLIC_SHOW_WEBMCP_UI`)
- Synthetic geography (no OSM/SF tiles)
- Disk-backed project persistence (`DATA_DIR` / Render mount)

## Tests added

- `src/lib/domain/projects.test.ts`: sort, rename validation, duplicate detect, delete cascade, `lastOpenedAt`, format helpers

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: home loads with skeleton → projects appear sorted → search filters → Continue shows 3 recent → open workspace (records last opened) → return home → rename project → try duplicate name on `/new` (warning) → delete project with confirm → force API error → Retry restores list → greeting matches local hour.
