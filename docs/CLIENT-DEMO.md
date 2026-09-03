# Client demo — Urban Planning Copilot

Live: https://urban-planning-copilot.onrender.com/

A planner and an external agent share one map and one study. The agent does not scrape the UI. It calls WebMCP tools (`document.modelContext`) and the workspace actually moves.

**The brief:** site 2,000 infill homes in Mission/SoMa, San Francisco, within a 10-minute walk of frequent transit, outside high-risk flood, without displacing parks or schools.

## What to record (~90s)

Pre-warm the live URL once so the opening is not a cold-start spinner.

1. **Home** — dashboard, not a blank map. Continue card: Mission/SoMa infill — 2,000 homes (or Client Demo SF Housing).
2. **Workspace results** — 572 eligible sites, about 1,098 homes of capacity. Top site Mission Blk/Lot 3595006 at 94.3, then 4086004 at 80.6, SoMa 3520087 at 78.3. Map markers on the lots.
3. **Agent workbench** — Connected, 31 tools. Planner and agent are on the same study.
4. **`set_map_view`** in JSON: `{ "center": [-122.3893, 37.7955], "zoom": 16 }` — the Leaflet map pans (scale 500 m → 100 m).
5. **`list_candidates`** then **`add_to_shortlist`** — ranked JSON comes back, the UI shows Shortlist: 1 and the top row flips to Unpin. Do not click Run analysis in the app.
6. **`start_planning_project`** — a new Mission/SoMa housing study; the URL changes; target is 2,000 homes.

Workbench argument forms default to Form mode. Switch to JSON when the arg is an array (`center`).

## Why this sells it

- **WebMCP leverage:** tools mutate the live map and study, not a chat veneer.
- **Execution:** create → rank → map → shortlist → decide.
- **Impact:** a real infill siting problem with transit and flood constraints.
