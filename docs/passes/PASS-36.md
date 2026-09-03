# PASS-36 — Stitch UI/UX fidelity (deferred pass-35 items)

## Scope

UI/UX fidelity pass for Compare, Decision, candidate drawer, Explore, and Report — aligned to Civic Intelligence design tokens and Stitch references (`03-analysis-results`, `04-decision-review`, scenario comparison, decision review, explore, reports).

**Not touched:** `store-postgres.ts`, data pipelines, pass-34/35 home dashboard, copilot feed, glass map chrome, provenance chips.

## Shipped

### Compare
- **KPI matrix** — `CompareMetricsTable` with Civic “Calculated comparison” header, column tints, best-value emphasis.
- **Dual synchronized maps** — `CompareScenarioMaps` + `PlanningMap` controlled viewport sync (pan/zoom linked across two scenario columns).
- **Copilot interpretation** — confidence bar (4px), AI recommendation chip, narrative from compare insights.
- **Select preferred** — sticky footer with per-scenario actions (primary scenario uses tertiary fill).
- Trade-off bullet list from `compare_scenarios` insights (not a lone table).

### Decision
- **Review decision** header with serif-scale title and amber **Ready for human review** badge when analysis is fresh.
- **Copilot recommendation** card with Intelligence Blue (`#005E7D`) top accent bar.
- Bento **Evidence summary** + **Key trade-offs** grid (derived from yield gap, capacity, transit, recommendation note).
- Amber-tinted **Uncertainty & limitations** panel.
- **Approve** (Human Amber `#815504`), Request changes, Reject + optional rationale + **Decision history**.
- Scenario map sidebar retained on large screens.

### Candidate drawer (Results / evidence panel)
- 4px **confidence bar** on selected candidate (score-based fill).
- Tabs: **Why this candidate** | **Evidence** | **Sensitivity**.
- Sensitivity branches via existing `create_scenario_branch` (`Transit sensitivity`, `Flood-weighted branch`, `Capacity-first branch`).

### Explore
- Map-first layout with **glass query panel** overlay (`glass-panel`, 4px radius).
- Example questions + suggested exploration chips (no pills).
- Findings table/KPIs below map; data pipeline unchanged.

### Report
- **Bento grid** of report cards (status, project/scenario meta, date).
- **Generate drawer** (right rail) — no raw JSON in the main canvas.
- **Preview drawer** — section bento tiles with provenance chips; comparison/metric tables formatted, not dumped JSON.

## Deferred

- **Triple-map compare sync** — dual-map ships for 2+ selected scenarios; third+ scenarios noted in UI with reference to this doc. Triple column grid is in Stitch but omitted to keep map sync reliable and bundle size stable.

## Design tokens applied

- Intelligence Blue `#005E7D` / `primary-container` — AI, copilot accents.
- Human Amber `#815504` / `secondary` — planner review, approve.
- Canvas `#fcf9f8`, 4px radius (`rounded`), Geist + JetBrains Mono data labels.
- No “UrbanSight AI”; product name remains Urban Planning Copilot.

## Verification

```bash
npm test
npm run build
```

Manual: workspace **Compare** (2 analyzed scenarios → matrix + maps + footer), **Decision** (fresh analysis → amber badge + approve), **Results** drawer tabs, **Explore** glass panel, **Report** bento + generate/preview drawers.
