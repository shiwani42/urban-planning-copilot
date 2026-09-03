# Urban Planning Copilot

Production-oriented AI-native urban planning workspace.

**Live app:** https://urban-planning-copilot.onrender.com/

## What this is

A map-first planning application where human planners and an AI collaborator share one coherent domain state: objectives, constraints, spatial analysis, scenarios, evidence, decisions, and reports.

Stitch screens in `stitch_urban_planning_copilot/` are the visual reference. Application architecture follows `SPEC.md` and is evaluated by `EVAL.md`.

## Why WebMCP

Urban Planning Copilot is built for **browser WebMCP** — the AI agent operates the **same live application** the human sees, via semantic domain tools (not DOM scraping).

- **One state:** UI buttons and WebMCP tools call the same `/api/projects` domain services.
- **Journey tools:** `start_planning_project` → `get_analysis_plan` → `run_analysis` → `list_candidates` / `inspect_candidate` → adjust criteria → `create_scenario_branch` / `compare_scenarios` → human-gated `stage_proposal` / `approve_proposal` → `generate_report` → `verify_operation`.
- **Human checkpoints:** Consequential changes can be staged as visible proposals; approval is revision-bound and returns a SHA-256 receipt via `verify_operation`.
- **Sensitive tools** (`approve_scenario`, `approve_proposal`, `reject_candidate`, `generate_report`) use `requestUserInteraction()` in supporting browsers.

### Enable WebMCP

1. **Chrome flag:** `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch  
2. **Or** Chrome origin trial: https://developer.chrome.com/blog/ai-webmcp-origin-trial  
3. **ChatGPT** in-app browser (when WebMCP is available)

### Browser registration (real code)

Tools register on the top-level page from the root layout:

```tsx
// src/components/WebMcpProvider.tsx → registerPlanningWebMcpTools()
await document.modelContext.registerTool({
  name: "run_analysis",
  description: "Run spatial analysis for a scenario",
  inputSchema: { /* JSON Schema */ },
  execute: async (input) => { /* calls /api/mcp */ },
});
```

Inspect registered tools: `window.__UPC_WEBMCP_TOOLS__` or Chrome DevTools → Application → WebMCP.

### Eval commands

```bash
npm install
npm run eval:webmcp:local          # schema + eval fixture validation
npm run dev
npm run eval:webmcp:smoke          # live page tool smoke test
```

HTTP bridge (headless / CI):

```bash
curl -s http://localhost:3000/api/mcp | jq '.tools[].name'
curl -s -X POST http://localhost:3000/api/mcp \
  -H 'Content-Type: application/json' \
  -d '{"tool":"list_datasets","arguments":{}}' | jq
```

Full guide: [`webmcp/README.md`](./webmcp/README.md)

## Stack

- Next.js (App Router) + React + TypeScript
- Tailwind CSS (Civic Intelligence design tokens)
- Leaflet / React-Leaflet for map rendering
- Turf.js for deterministic spatial analysis (server-side)
- WebMCP semantic tools (`webmcp/schema.json`, 21 journey tools)
- JSON persistence under `DATA_DIR` (`store.json`; `/var/data` on Render with persistent disk). Git-tracked SF snapshots live in `snapshots/sf/`.

## Run locally

```bash
npm install
npm run seed    # optional demo projects
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
3. Run spatial analysis (real Turf operations — not hard-coded rankings)
4. Inspect candidates on the map and in the results table (synced selection)
5. Change constraints / weights / geographic exclusions → results become stale → recalculate
6. Branch scenarios, compare, record human decisions
7. Stage proposals → approve in UI → verify SHA-256 receipt
8. Generate a report; refresh and resume

## Data & persistence

- Initial geography is **synthetic** seed data (clearly labeled in UI and reports).
- On Render, a **1 GB persistent disk** mounts at `data/` so projects survive restarts and deploys within the same service instance.
- `npm run seed` creates demo projects when the store is empty (also runs on Render start).
- Disabling or missing required datasets (e.g. flood) causes analysis to **fail closed** — no fabricated results.

## Design tokens

- Intelligence Blue (`#005E7D`) = AI / calculated recommendations
- Human Amber (`#815504`) = planner decisions and human review
- Provenance chips distinguish source data, calculated metrics, AI recommendations, and planner decisions

## License

MIT — see [LICENSE](./LICENSE).
