# Production Hardening Pass 02

Scope: scenario branching → reweight → compare → evidence → explore → reports workflow (EVAL 8–10).

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Compare button silent / no loading | Dedicated `compareBusy` state; uses `act("compare_scenarios")`; immediate spinner + error alert; table renders on response |
| 2 | Compare chips silently deselect below 2 | `aria-pressed` chips; cannot deselect when only two remain; status copy explains ≥2 requirement |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 3 | No per-candidate Meets/Shortfall vs 2,000-home goal | `housing_target_gap` metric per candidate; **vs goal** column in results table |
| 4 | Legend overlaps results table | Collapsible legend (default closed); positioned above drawer |
| 5 | Fake keyboard navigation | ArrowUp/Down roving focus moves selection + evidence; Enter/Space selects |
| 6 | Map parcel click does not select candidate | Overlay layers `interactive={false}`; parcel tooltips; clicks reach candidate parcels |
| 7 | Stale global status after branching | Scenario-scoped status labels; per-scenario result counts; duplicate sets scenario-specific `resumeNote` |
| 8 | Compare metrics identical / useless | Rich metrics: meets-target count, median transit, top-3, weight profile; **Trade-off insights** panel with rank shifts |
| 9 | Reweighting inflates absolute scores | Composite score = weighted average of defined components only (no phantom 50); capacity scaled to housing target; tie-break by capacity |
| 10 | Flood constraint no-op shown as success | Limitation when flood filter had no effect; funnel copy retained from Pass 1 |
| 11 | Evidence limitations "None noted" | Candidates inherit analysis + dataset limitations (incl. incomplete flood mapping) |
| 12 | Priorities cannot reach 100% easily | **Normalize to 100%** control; Apply blocked until sum is 100% |
| 13 | Explore hijacks app / mints project | `/api/explore` scratch analysis; in-place results panel; no navigation or project creation |
| 14 | Explore textarea pre-filled | Placeholder + example chips instead of default value |
| 15 | Reports stub | Honest empty state; generate wired to **active scenario**; requires fresh analysis |
| 16 | Scenario naming non-editable | **Rename scenario** inline; parent lineage in scenario list |
| 17 | "Why this candidate?" opens wrong panel | Opens Evidence tab focused on selected candidate |
| 18 | Detail pane stale after recompute | Rebind selection by feature id; **Selection updated** cue after new result set |

## P2 — Fixed (where cheap)

| # | Issue | Resolution |
|---|-------|------------|
| 19 | Greeting / timestamps | Already on `plannerGreeting()` + `formatLocaleTime()` from Pass 1 — verified |
| 20 | Bare loading screen | Workspace loading skeleton with header chrome + spinner |
| 21 | Draw exclusion icon-only | `aria-label` + tooltip on exclusion control |
| 22 | Save-scenario icon-only | Deferred — header space constrained at 1024px; tooltip retained |
| 23 | Population/Schools layers off by default | Default-on for population + schools after analysis (map state seed) |
| 24 | Avg transit hardcoded feel | Documented mean + added median aggregate; per-row distances unchanged |
| 26 | Score breakdown unlabeled | Labeled as **weighted contribution** in evidence pane |

## P2 — Deferred

| # | Issue | Reason |
|---|-------|--------|
| 25 | Table sorting / filter / CSV | Needs dedicated table component; out of pass scope |
| 22 | Left rail scroll hides sections at 1024px | Layout pass — sidebar height not addressed without broader responsive refactor |

## Preserved

- Turf spatial engine
- Provenance chips
- snake_case WebMCP tools (UI hidden unless `NEXT_PUBLIC_SHOW_WEBMCP_UI`)
- Synthetic geography (no OSM/SF tiles)

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: create housing project → run analysis → duplicate scenario → reweight (normalize + apply) → recalculate → Compare (2 scenarios) → inspect trade-off insights → map click candidate → Evidence limitations → Explore scratch session → Generate report for active scenario.
