# WebMCP for Urban Planning Copilot

Sources curated in `docs/documentation.md`.

## Outcome-first design

Core outcome: **an auditable planner decision on a scenario**.

Journey chain (tools map to steps, not buttons):

```text
start_planning_project
        ↓
get_analysis_plan          (answer)
        ↓
run_analysis               (action)
        ↓
list_candidates / inspect_candidate   (answer)
        ↓
set_transit_threshold / set_priority_weights / exclude_map_area
        ↓
create_scenario_branch → compare_scenarios
        ↓
approve_scenario / approve_proposal / prefer_scenario / reject_candidate   (sensitive + confirmation)
        ↓
generate_report
        ↓
verify_operation           (SHA-256 receipt)
```

### Tool layers

| Layer | Tools | Notes |
| --- | --- | --- |
| Answer | `get_workspace`, `get_analysis_plan`, `list_candidates`, `inspect_candidate`, `list_datasets`, `compare_scenarios` | `readOnlyHint: true` |
| Action | `start_planning_project`, `set_*`, `run_analysis`, `create_scenario_branch`, `select_candidate`, `exclude_map_area` | Mutate working state |
| Sensitive | `approve_scenario`, `prefer_scenario`, `reject_candidate`, `generate_report` | `requestUserInteraction()` |

## Enable WebMCP in Chrome

1. Origin trial: https://developer.chrome.com/blog/ai-webmcp-origin-trial
2. Or local flag: `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch
3. Docs: https://developer.chrome.com/docs/ai/webmcp
4. Security: https://developer.chrome.com/docs/ai/webmcp/secure-tools

## Debug with Chrome DevTools

https://developer.chrome.com/docs/devtools/application/webmcp

1. Open `http://localhost:3000/new` (WebMCP enabled)
2. DevTools → **Application** → **WebMCP**
3. Confirm Available tools (18 planning tools)
4. Select a tool → fill params → **Run tool** (deterministic)
5. Use Invoked tools log while chatting in nekuda Workbench

## Debug with nekuda Workbench

Install [nekuda WebMCP Workbench](https://chromewebstore.google.com/detail/nekuda-webmcp-workbench/amochnnbmnkjjlblolhpddkokhnalkjp):

- Open the app → press **Alt+K** (focus Ask nekuda)
- See registered tools, invoke manually, or chat with the agent
- Page also sets `window.__UPC_WEBMCP_TOOLS__` for console inspection

Example prompts:

- "Create a North River project for 2000 homes within 800m of transit outside flood zones."
- "Show the analysis plan, then run analysis."
- "Why is the top candidate recommended?"
- "Set transit to 500m and recalculate."

## Evaluate with WebMCP Evals CLI

https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals

Fixtures live in `webmcp/`:

```bash
# Schema-only (no browser)
npx webmcp-evals local -t webmcp/schema.json -e webmcp/evals.json

# Live page smoke (no LLM key) — start the app first
npm run dev
npx webmcp-evals smoke -u http://localhost:3000/new -e webmcp/evals.json -v

# Live browser LLM evals
npx webmcp-evals browser -u http://localhost:3000/new -e webmcp/evals.json --open
```

## HTTP bridge (headless / CI)

Same domain operations without a browser agent:

```bash
curl -s http://localhost:3000/api/mcp | jq '.tools[].name'
```

## Inspiration

- Directory of implementations: https://webmcp.com
- Journey design guide: https://webmcp.com/blog/building-user-journeys-with-webmcp
- More resources: https://webmcp.com/resources
