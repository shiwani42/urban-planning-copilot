# Urban Planning Copilot — Live trial audit (IMPROVEMENTS)

**Live URL:** https://urban-planning-copilot.onrender.com/  
**Audit date:** September 2026 (pre-PR #1 deploy)  
**Purpose:** Document live vs. spec gaps for judges, Devpost writeup, and follow-up work.

---

## Executive summary

The backend domain model (spatial analysis, scenarios, provenance, WebMCP journey tools) is sound. The **pre-fix live build** failed on map rendering and several workspace interactions that judges screenshot first. PR #1 addresses P0 items below; P1 items remain for post-challenge polish.

---

## P0 — Product-killing (must fix for judges)

### 1. Map grey void
- **Observed:** Leaflet/CARTO attribution visible; no basemap tiles; study area unreadable.
- **Cause:** CARTO URL with invalid/missing `NEXT_PUBLIC_CARTO_API_KEY`; ArcGIS fallback unreliable on Render.
- **Fix (PR #1):** OpenStreetMap fallback when no CARTO key; zoom + scale controls; visible parcel/flood/transit layers; dynamic legend.
- **Acceptance:** Pan/zoom works; parcels and flood overlay visible; map ↔ table selection sync.

### 2. Compare broken
- **Observed:** Selecting two scenarios enables Compare; clicking Compare deselects a chip; comparison table never renders.
- **Cause:** Compare action triggered workspace refresh / stale closure; chip toggle used non-functional state updates.
- **Fix (PR #1):** Direct compare API call preserving selection; functional `setCompareIds`; labeled metrics table (eligible, capacity, transit, score).
- **Acceptance:** Two+ scenarios stay selected; table renders consistent metrics per Stitch `scenario_comparison_workspace_multi_strategy_evaluation`.

### 3. Exclusion polygon offset + Finish adds vertex
- **Observed:** Dashed red exclusion sits up-left of clicked grid; Finish button adds an extra map point.
- **Cause:** Finish control overlaid on map without `stopPropagation`; click leaked to map handler.
- **Fix (PR #1):** `pointer-events` + `stopPropagation` on controls; live preview vertices; correct `[lng,lat]` → `[lat,lng]` for Leaflet.
- **Acceptance:** Polygon matches clicks; Finish does not add vertices.

### 4. Layer toggles cosmetic
- **Observed:** Population / Schools / Infrastructure checkboxes change no map pixels.
- **Cause:** `PlanningMap` only rendered parcels, flood, transit, schools (partial).
- **Fix (PR #1):** Render population (scaled circles), infrastructure nodes, schools; legend reflects visible layers.
- **Acceptance:** Toggling each layer shows/hides features on map and legend.

### 5. Review assumptions dead click
- **Observed:** Button toggles state but panel only existed inside closed results drawer.
- **Fix (PR #1):** Assumptions panel in Agent activity sidebar; edits call `update_assumptions` and mark results stale.
- **Acceptance:** Developable fraction, density, transit threshold editable; stale banner after change.

### 6. Approve/Reject silent no-op
- **Observed:** Empty reason field; buttons appear to do nothing.
- **Fix (PR #1):** Inline validation — reason required for approve/reject; toast on success.
- **Acceptance:** Error message when reason empty; decision recorded when valid.

### 7. Copilot panel misleading + clipped content
- **Observed:** “Ready for instruction” with no input; STATUS / Decision History / Scenarios clipped mid-content.
- **Fix (PR #1):** Renamed to **Agent activity** with accurate status text; `min-h-0` + `overflow-y-auto` on panes.
- **Acceptance:** No false chat promise; scrollable sidebars and decision history.

### 8. Save scenario — no feedback
- **Fix (PR #1):** In-workspace toast: `Scenario "…" saved`.

### 9. Report dumps raw JSON
- **Observed:** Comparison section rendered `JSON.stringify` blob.
- **Fix (PR #1):** HTML table for scenario comparison metrics; **Download Markdown** export.

---

## P1 — Important (post-P0 polish)

| Area | Gap | Notes |
|------|-----|-------|
| Project home | Continue cards need live activity timestamps | Seed data + resume notes wired; richer agent/human chips optional |
| Workspace Stitch fidelity | Three-pane density, ghost proposal styling | Hierarchy aligned; not pixel-perfect |
| Explore mode | Convert finding → project | API exists; UX flow thin |
| Data page | Flood `incompleteCoverage` banner on workspace | Shown on Data tab; surface in analysis limitations |
| WebMCP in ChatGPT | Requires browser flag or origin trial | Documented in README; 21 tools on `/`, `/new`, `/workspace/:id` |
| Render persistence | Disk mount on existing service | Blueprint updated; may need Dashboard attach |

---

## WebMCP (PR #1 — keep direction)

- **Unified catalog:** 21 snake_case journey tools; HTTP `/api/mcp` matches browser `registerTool`.
- **Human checkpoint:** `stage_proposal` → UI banner → `approve_proposal` (revision-bound) → `verify_operation` SHA-256 receipt.
- **Sensitive tools:** `requestUserInteraction` on approve/reject/report paths.
- **Verify in Chrome:** `chrome://flags/#enable-webmcp-testing` → DevTools → Application → WebMCP → 21 tools on top-level document. ChatGPT in-app browser when WebMCP enabled.

---

## Brand & design tokens

- **Product name:** Urban Planning Copilot (never UrbanSight AI).
- **Intelligence Blue `#005E7D`:** AI / calculated / primary actions.
- **Human Amber `#815504`:** Planner decisions, action required, secondary emphasis.

---

## What already works (do not rewrite)

- Turf-based spatial analysis (not hard-coded candidates)
- Scenario branching via deep clone (B does not mutate A)
- Provenance chips and evidence panels
- Report section structure and domain-backed content
- WebMCP semantic tools (no DOM scraping)
- Fail-closed analysis when required datasets missing/disabled

---

## Testing checklist (post-deploy)

1. Open live URL → project home shows greeting + Continue cards.
2. Open workspace → map tiles + parcels + flood visible.
3. Run analysis → candidates on map and table; click syncs both ways.
4. Compare two scenarios → table renders, chips stay selected.
5. Draw exclusion → polygon matches clicks; recalculate changes results.
6. Toggle Population → dots appear on map + legend.
7. Review assumptions → edit value → stale banner.
8. Decision tab → approve without reason → validation error.
9. Save scenario → toast.
10. Generate report → table not JSON; download `.md`.
11. WebMCP → 21 tools on `/new` in Chrome DevTools.

---

## Remaining risks until Render deploys PR #1

- Live site still runs **pre-PR** build until merge + deploy.
- Persistent disk may require manual attach on existing Render service.
- Free tier cold start (~30s) affects judge first impression.
