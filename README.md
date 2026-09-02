# Urban Planning Copilot

Production-oriented AI-native urban planning workspace.

## What this is

A map-first planning application where human planners and an AI collaborator share one coherent domain state: objectives, constraints, spatial analysis, scenarios, evidence, decisions, and reports.

Stitch screens in `stitch_urban_planning_copilot/` are the visual reference. Application architecture follows `SPEC.md` and is evaluated by `EVAL.md`.

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS (Civic Intelligence design tokens)
- Leaflet / React-Leaflet for map rendering
- Turf.js for deterministic spatial analysis (server-side)
- Zod-validated WebMCP semantic tools
- JSON file persistence under `data/store.json`

## Run

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
npm test
npm run build
```

## Core workflow

1. Create a project with a natural-language planning objective
2. Review the generated analysis plan
3. Run spatial analysis
4. Inspect candidates on the map and in the results table (synced selection)
5. Change constraints / weights / geographic exclusions → results become stale → recalculate
6. Branch scenarios, compare, record human decisions
7. Generate a report; refresh and resume

## WebMCP

Outcome-first browser tools + HTTP bridge. Full guide: [`webmcp/README.md`](./webmcp/README.md) and [`docs/documentation.md`](./docs/documentation.md).

**Enable in Chrome:** origin trial or `chrome://flags/#enable-webmcp-testing`.

**Debug:** [nekuda WebMCP Workbench](https://chromewebstore.google.com/detail/nekuda-webmcp-workbench/amochnnbmnkjjlblolhpddkokhnalkjp)

**Evals:**

```bash
npx webmcp-evals local -t webmcp/schema.json -e webmcp/evals.json
npm run dev
npx webmcp-evals smoke -u http://localhost:3000/new -e webmcp/evals.json -v
```

**HTTP bridge:**

```bash
curl -s http://localhost:3000/api/mcp | jq '.tools[].name'
```

Tools are domain operations (`run_analysis`, `set_transit_threshold`, `approve_scenario`, …) — never DOM selectors. Sensitive tools confirm via `requestUserInteraction`.

## Data

Initial geography is **synthetic** seed data (clearly labeled). Datasets are swappable through adapters/metadata; analysis reads live feature collections, not hard-coded rankings.

## Design notes

- Intelligence Blue (`#005E7D`) = AI / calculated recommendations
- Human Amber (`#815504`) = planner decisions
- Provenance chips distinguish source data, calculated metrics, AI recommendations, and planner decisions
