# PASS-45 — Decision and Report as first-class workspace pages

Live reference: https://urban-planning-copilot.onrender.com/

## Scope

Passes 43–44 made workspace tabs path-based (`/workspace/:id/decision`, `/workspace/:id/report`) and fixed compare/results regressions. Pass 45 closes confirmed gaps so Decision and Report behave as full planner workflows — copilot navigation, evidence gating, report staleness, and Results → pin → Decision handoff.

No `store-postgres.ts` changes, no secrets, no persistence regressions.

## Shipped

### Decision (`/workspace/:id/decision`)
- Copilot recommendation card uses Intelligence Blue accent (`primary-container`, 4px left border).
- Yield gap banner and uncertainty/limitations section unchanged from pass 36+.
- Approve uses Human Amber (`secondary`); Request changes / Reject remain distinct.
- Rationale required before approve/reject confirm (existing `validateDecisionReason` gate).
- Decision history lists prior calls for the active scenario.
- Approve actions and “Ready for human review” only appear when `requireAnalysisForDecision` passes — empty or stale evidence does not show Approve as ready.
- “Ready for human review” badge uses blue (not amber) so it is not confused with the Approve CTA.

### Report (`/workspace/:id/report`)
- Bento cards, generate drawer, and preview panel (markdown sections, comparison tables — never raw JSON).
- Markdown export from preview drawer.
- Reports marked stale when analysis recalculates; UI also flags reports older than the latest completed analysis.
- Stale banner explains when analysis or decisions postdate the snapshot.

### Copilot NL → real tabs + tools
- “open decision” / “decision review” → `/workspace/:id/decision` (not feed-only).
- “approve” / “approve scenario” → Decision tab + `approve_scenario` (human-gated; pending opens Decision).
- “generate report” → Report tab + `generate_report` tool; success selects the new report.
- “open report” → Report tab only.

### Results → pin → Decision
- Pin toast offers **Review decision** (navigates to Decision path tab).
- Shortlist panel on Results includes **Review in Decision →** when sites are pinned.

## Verification

```bash
npm test
npm run build
```

Manual: Run analysis → Results → pin a site → **Review decision** opens `/workspace/:id/decision` without 404; copilot “open decision”, “generate report”, and “approve” switch path tabs and invoke tools; recalculate analysis marks prior reports Stale on Report tab; Decision hides Approve until analysis is complete and current.
