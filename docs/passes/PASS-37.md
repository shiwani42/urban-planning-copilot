# PASS-37 — Activity timeline, create inspector, triple-map compare, planner friction

## Scope

Stitch UI fidelity and planner-friction pass aligned to:

- `activity_provenance_timeline_workspace_audit`
- `new_planning_workspace_animated_experience`
- `scenario_comparison_workspace_multi_strategy_evaluation` (triple-map)
- `planning_workspace_scenario_builder_transit_first_draft` (workspace copy)

**Not touched:** `store-postgres.ts`, analysis math, persistence layer.

## Shipped

### Activity
- Filter chips: **All / Agent / Human / Analysis / Data / Decisions** (4px radius, not pills).
- Intelligence Blue (`#005E7D`) vertical **thread-line** on the timeline; human amber / copilot blue left accent bars on cards.
- Export activity button; provenance-tree detail drawer with Civic inspector styling.
- Product copy uses **Urban Planning Copilot** — no UrbanSight AI.

### New project / create
- Four **example question** cards (housing, transit, schools, climate resilience) with hover sync to inspector.
- Live **What I'll prepare** right rail: objective, geography, datasets, analyses with Intelligence Blue analysis thread-line.
- Civic tokens: `#F0EEEB` inspector header, `primary-container` accents, Geist + JetBrains Mono labels.

### Compare
- **Triple-map sync** when three or more analyzed scenarios are selected (`COMPARE_SYNCED_MAP_LIMIT = 3`).
- Shared pan/zoom across up to three columns; fourth+ scenarios remain in KPI matrix only.

### Planner friction
- Workspace inspector title: Urban Planning Copilot (not “AI Copilot”).
- Explore map attribution chip: `rounded` (4px) instead of pill.
- **Decision**: provenance chips on copilot recommendation, evidence summary, and your decision.
- **Report**: provenance chips on header, bento cards, and preview sections (existing section chips retained).
- Copilot running copy: “Copilot is running a planning tool for this scenario…” (no “AI is thinking”).

## Design tokens

- Intelligence Blue `#005E7D` — thread-lines, agent accents, copilot chips.
- Human Amber `#815504` — human timeline nodes and MANUAL chips.
- Canvas `#fcf9f8`, 4px radius, Geist + JetBrains Mono.

## Verification

```bash
npm test
npm run build
```

Manual: workspace **Activity** (filters + thread-line), `/new` (example chips + inspector), **Compare** with 3 analyzed scenarios (triple maps), **Decision** and **Report** provenance chips.
