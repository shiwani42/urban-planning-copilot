# Urban Planning Copilot

Production-oriented AI-native urban planning workspace.

**Live app:** https://urban-planning-copilot.heisenbug.in/

## What this is

A map-first planning application where human planners and an AI collaborator share one domain state: objectives, constraints, spatial analysis, scenarios, evidence, decisions, and reports.

Humans use the workspace UI; agents use **browser WebMCP** semantic tools on the same live app (not DOM scraping). UI actions and agent tools both call `src/lib/domain/services.ts`.

Visual reference: `stitch_urban_planning_copilot/`. Architecture spec: `SPEC.md`. Evaluation rubric: `EVAL.md`.

## Architecture

Urban Planning Copilot is a **single-deployable, server-authoritative monolith**: Next.js UI + API routes + domain logic + in-process spatial analysis. Humans and WebMCP agents share one domain state — every mutation converges on `src/lib/domain/services.ts`.

### System context

```mermaid
flowchart TB
  subgraph actors["Actors"]
    HP["Human planner"]
    AI["AI agents (WebMCP)"]
    CI["CI / eval harness"]
  end

  subgraph system["Urban Planning Copilot"]
    UPC["Next.js app\n(UI + API + domain)"]
  end

  subgraph external["External"]
    CARTO["Carto basemap"]
    SF["SF Open Data snapshots"]
    NEON["Neon Postgres"]
    RENDER["Render host + disk"]
  end

  HP --> UPC
  AI --> UPC
  CI --> UPC
  UPC --> CARTO
  UPC --> NEON
  UPC --> RENDER
  SF -.-> UPC
```

### Layers

```mermaid
flowchart TB
  subgraph presentation["Presentation"]
    PAGES["page.tsx · workspace-client.tsx"]
    MAP["PlanningMap · UrbanPlanningCopilot"]
    HOOKS["useWorkspace()"]
  end

  subgraph api["API boundary"]
    API["/api/projects · /api/mcp\n/api/datasets · /api/explore"]
  end

  subgraph domain["Domain core"]
    SVC["services.ts"]
    SPA["spatial.ts · objective.ts"]
    CMP["compare · decision · shortlist"]
  end

  subgraph integration["Agent integration"]
    WMCP["server-handlers · register-browser"]
    SYNC["workspace-sync event bus"]
  end

  subgraph storage["Persistence"]
    STORE["store.ts cache"]
    PG["Postgres or store.json"]
    SNAP["snapshots/sf/*.geojson.gz"]
  end

  presentation --> api --> domain --> storage
  integration --> api
  integration --> domain
  domain --> SNAP
```

### Planning journey

```mermaid
sequenceDiagram
  actor Planner
  participant UI as workspace-client
  participant API as /api/projects
  participant Svc as services.ts
  participant Spa as spatial.ts

  Planner->>UI: Set weights / constraints
  UI->>API: PATCH update_*
  API->>Svc: updateStore()
  Planner->>UI: Run analysis
  UI->>API: PATCH run_analysis
  API->>Svc: runAnalysis()
  Svc-->>Spa: setImmediate → Turf ranking
  UI->>API: GET refresh
  API-->>UI: WorkspaceSnapshot + candidates
```

### Dual client — one state

```mermaid
flowchart LR
  BTN["UI controls"] --> ACT["useWorkspace().act()"]
  ACT --> PATCH["PATCH /api/projects"]
  TOOL["WebMCP tool"] --> MCP["POST /api/mcp"]
  MCP --> SVC["services.*()"]
  PATCH --> SVC
  SVC --> STORE["updateStore()"]
  MCP --> EVT["notifyWorkspaceMutated"]
  EVT --> REFRESH["refresh()"]
```

Key paths: `src/app/workspace/[projectId]/workspace-client.tsx` (planner shell), `src/lib/domain/services.ts` (mutations), `src/lib/webmcp/` (agent tools), `src/lib/domain/store.ts` (persistence).

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

## Stack & persistence

- Next.js (App Router), React, TypeScript, Tailwind CSS
- Leaflet / Turf.js for map rendering and server-side spatial analysis
- WebMCP journey tools — see [`webmcp/README.md`](./webmcp/README.md)
- Local: `store.json` under `DATA_DIR`. Production: set `DATABASE_URL` to a Postgres URI (e.g. Neon) so projects survive deploys
- Geography seed data in `snapshots/sf/`; missing required datasets fail analysis closed (no fabricated results)

## WebMCP

Enable in Chrome: `chrome://flags/#enable-webmcp-testing`, or the [origin trial](https://developer.chrome.com/blog/ai-webmcp-origin-trial), or ChatGPT in-app browser when available.

Consequential actions (approve, reject, generate report) require human confirmation in the UI. Debug tools: Chrome DevTools → Application → WebMCP, or nekuda Workbench (Alt+K).

```bash
npm run eval:webmcp:local    # schema + fixture validation
npm run eval:webmcp:smoke    # live page smoke (dev server required)
```

**Demo prompts** (natural language, no tool names): [`docs/prompts.md`](./docs/prompts.md)

## Planner workflow

1. Create a project with a natural-language objective
2. Review the analysis plan and run spatial analysis
3. Inspect ranked candidates on the map and in the results table
4. Adjust weights, transit threshold, or exclusions → recalculate when stale
5. Branch scenarios, compare, shortlist, and record a human decision
6. Generate a report

## Design tokens

- Intelligence Blue (`#005E7D`, `primary-container`) — AI recommendations and agent activity
- Human Amber (`#815504`, `secondary`) — planner decisions, shortlist, manual review
- Provenance chips: Observed · Calculated · AI REC · MANUAL

## License

MIT — see [LICENSE](./LICENSE).
