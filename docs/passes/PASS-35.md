# Pass 35: Stitch UI/UX fidelity

## Goal

Align the live product with Stitch mockups (`01-home` through `04-decision-review`) without regressing Postgres persistence from pass 34.

## Shipped

### Home dashboard (`01-home.png`)

- **Greeting** + subtitle (“Continue your planning work…”); no blank-map shell or home copilot sidebar.
- **Continue** carousel: map-style thumbnail, scenario chip, provenance-colored activity footer (AI / data / manual).
- **Recent Analyses** table (name, project, status, result, timestamp) from `/api/projects` `recentAnalyses`.
- **Action Required** sidebar with AI REC / DATA / MANUAL chips.
- **Recent system activity** feed when store events exist.

### Workspace (`02-workspace-initial.png`)

- Context **360px** / inspector **320px** (`sidebar-width`, `inspector-width`).
- Status bar: planning objective line + constraint chips with transit / flood / zoning icons.
- Right pane **AI Copilot** → **Agent logic feed** (plan steps, findings, tool runs) — not an empty chat widget.
- `commandOnly` copilot input at bottom; Intelligence Blue **Run analysis** + inner glow while running; Pause / Stop tracking controls.
- Glass map chrome retained; **selected-parcel** Inspect / Exclude / Include toolbar when a candidate is selected.

### Provenance chips

- **Observed** (outline), **Calculated** (grey), **AI REC** (Intelligence Blue), **MANUAL** (Human Amber).
- Approve / planner actions use amber; run analysis uses `#005E7D` primary-container.

### Copy

- Removed “Welcome, planner” flash and “No project open” home copilot copy.

## Deferred (later pass)

- Compare triple-map layout
- Decision review recommendation card polish (`04-decision-review.png` details)
- Explore page restyle
- Reports bento grid

## Verify

```bash
npm test
npm run build
```

Manual: `/` shows dashboard structure when empty and when projects exist; workspace panes 360/320, status bar chips, copilot feed populated after plan/analysis.
