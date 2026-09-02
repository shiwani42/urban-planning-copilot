# Production Hardening Pass 01

Scope: create-project → analysis-plan → run-analysis → inspect first candidate workflow.

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 12 | Real SF OSM labels under synthetic parcels | Removed OSM/CARTO tile layers; neutral grid basemap; study-area bounds lock; banner **Synthetic geography — not a real city** |
| 15 | Results table rows not clickable | Row `role="button"` + keyboard support; drawer uses `pointer-events-none` wrapper with interactive child; selection syncs map + evidence pane |
| 16 | Evidence tab non-functional | Candidates/Evidence are real tabs with state; row click switches to Evidence |
| 25 | No answer for 2,000-home target | Aggregate `housing_target_gap` metric; **Meets / Shortfall** chip in objective bar and results drawer |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Header "+ New planning project" first click no-op | Replaced `router.push` button with `<Link href="/new">` in shared `AppHeader` |
| 3 | WebMCP chrome://flags panel on home | Hidden unless `NEXT_PUBLIC_SHOW_WEBMCP_UI=true`; badge in `WebMcpProvider` gated the same way |
| 4 | Empty-state data-disk leak | Planner copy: projects appear once saved |
| 5 | Required-field error below fold | Per-field `role="alert"` errors, `aria-invalid`, focus on first invalid field |
| 8 | "hello" generates confident plan | `assessObjectiveQuality()` blocks create + shows warning; server rejects uninterpretable objectives |
| 9 | Back discards /new draft silently | SessionStorage draft + confirm on navigate away |
| 14 | Activity timestamps at ~4:20 AM | `formatLocaleTime()` uses browser locale/timezone |
| 17 | Results panel blocks legend / collapse | Drawer `pointer-events-none` shell; legend + collapse at z-1001 above drawer |
| 18 | Table clipped; legend overlap | Horizontal scroll + `min-w` on table; legend moved above drawer |
| 19 | Stale badge clipped on chip bar | Dedicated bordered stale chip; flex-wrap on objective bar |
| 20 | Stale table still looks current | Stale opacity on rows, map layers, and aggregate cards |
| 21 | Duplicate assumptions editors | Removed assumptions block from results drawer; right-rail editor only |
| 22 | Transit constraint unlabeled "800" | `aria-label` + visible "Meters" label |
| 23 | Priority sliders without names; no sum guard | `aria-label` per slider; sum-to-100% guard before apply |
| 26 | Ranking vs 2,000-home goal opaque | Score breakdown section on selected candidate + capacity vs goal note |
| 27 | Flood constraint green check with 45→45 | Funnel log notes no overlap; info icon + explanatory copy instead of false positive |
| 30 | Icon-only workspace nav | Visible labels on xl screens; `aria-label` + `title` on all tabs |

## P2 — Fixed (where cheap)

| # | Issue | Resolution |
|---|-------|------------|
| — | Greeting timezone | `plannerGreeting()` uses local hour |
| — | 1-char project names | Minimum 2 characters on create |
| — | /new missing global header | Shared `AppHeader` on `/new` |
| — | Bare "Loading projects…" | Spinner + loading text |
| — | "Apply & mark stale" jargon | Renamed **Apply priorities** |
| — | "Baselinedraft" missing space | Scenario list shows `· draft` separator |
| — | Duplicate "Riverside H" names | Grid coordinates appended to Riverside parcel names |
| — | Score 88 vs 88.2 | Consistent one-decimal formatting in results |

## Deferred

| # | Issue | Reason |
|---|-------|--------|
| — | Stale validation error that doesn't clear on /new | Needs broader form-state audit beyond this pass scope |
| — | Truncated "New project — r…" resume chip | Copy lives in `resumeNote` server strings; needs product copy pass |
| — | Move synthetic coords off SF lat/lng | Would invalidate stored project geometries; basemap + bounds fix chosen instead |

## Preserved

- Turf spatial analysis engine
- Provenance chips
- WebMCP tool registration (hidden UI only; tools still register)

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: `/new` → create housing project → workspace → Run analysis → open results drawer → click rank-1 row → Evidence tab → confirm map selection and capacity vs target chip.
