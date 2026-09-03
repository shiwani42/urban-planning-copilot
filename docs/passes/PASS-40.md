# PASS-40 — Copilot exclude + planner friction fixes

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Ship Pass 39 deferred **Exclude from copilot NL**, fix stale scenario context after branch activation, and verify home `?scenarioId=` deep links. No `store-postgres.ts` changes, no secrets, no token restyle.

## Shipped

### Copilot exclude from natural language
- When the map has an **exclusion polygon draft** (≥3 vertices in exclude draw mode), copilot `exclude` / `add_exclusion` routes to `exclude_map_area` with the drafted ring and label.
- When a **parcel is selected** on the map, the same phrases route to new `exclude_features` (same API as map Exclude toolbar).
- With no draft or selection, copilot returns one clear action: **“Draw an exclusion on the map, then tell me to exclude it.”**
- Successful exclude tools clear local draw state and mark criteria stale (keyboard / toolbar stay aligned).

### Stale scenarioId after branch activation
- MCP `resolveScenarioId` ignores unknown `scenarioId` args and falls back to the project’s active scenario (matches domain resolution).
- Copilot prefers live WebMCP browser context for scenario id instead of stale React props.
- Workspace mutation handler updates browser context when `activeScenarioId` is emitted (branch create / activate).

### Home `?scenarioId=` deep links
- Removed ref that blocked re-activating a scenario when returning from home with the same `scenarioId` after manual scenario switches.

## Verified OK (no change)

| Area | Notes |
|------|--------|
| Decision Approve rationale | `validateDecisionReason` still gates approve/reject before confirm modal; label still marks reason required |

## Verification

```bash
npm test
npm run build
```

Manual: Draw exclusion polygon → copilot “exclude this area” applies it; select parcel → copilot “exclude” matches toolbar; create branch → pin/exclude without 404; home Recent Analyses opens correct branch; approve without reason blocked before modal.
