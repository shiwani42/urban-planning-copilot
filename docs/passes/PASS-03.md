# Production Hardening Pass 03

Scope: decision integrity, confirmation flow, reports, map/evidence sync (EVAL 27, 28, 30).

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Approve succeeds with junk/no analysis | Server-side `canRecordScenarioDecision()` requires fresh completed analysis + min 10-char substantive reason; errors surface in Decision tab `role="alert"` |
| 2 | Approved decision survives weight/constraint changes | `invalidateScenarioDecision()` on input changes; `approvedAgainstConfigHash` / `approvedAgainstResultId` tracking; UI shows **Decision stale — re-approve required** |
| 3 | AI recommendation badge on selected candidate | Badge only when `selected.id === topCandidate.id` (rank 1) in evidence pane |
| 4 | Map parcel click does not sync evidence | Candidate selection derived from `mapState.selectedCandidateId` (no desynced local state); map click opens drawer on Evidence panel |

## P1 — Fixed

| # | Issue | Resolution |
|---|-------|------------|
| 5 | Legend overlaps results table | Legend moved to top-left of map (`top-16`), default collapsed |
| 6 | Decision reason leaks across scenarios | Per-scenario `decisionReasonByScenario` map keyed by `scenario.id` |
| 7 | Approve has no confirmation | Modal review (scenario, Copilot rec, reason, limitations) before `record_decision` |
| 8 | Download Markdown no-op | Blob download with `document.body.appendChild(a)` + charset; planner-facing timestamps |
| 9 | Report stuck stale after recalculate | Fresh result via `latestResultId`; `getLatestFreshResult()` gates report generation on non-stale result only |
| 10 | Second report replaces first | Reports append to store; **Report history** list per scenario with timestamped selection |
| 11 | Normalize to 100% permanently disabled | Enabled when sum ≠ 100% (±0.5 tolerance); Apply still blocked until exactly 100% |
| 12 | Activity shows HUMAN/AGENT + UTC times | `formatActivitySummary()` (“You approved…”, “Copilot recommended…”) + `formatLocaleDateTime()` |
| 13 | Report body structurally confused | Separate Objective / Planner decision sections; human-readable dataset lines; no raw `synthetic=true` flags; vs-target metrics |
| 14 | Decision buttons enabled before analysis | Approve / Request changes / Reject disabled until fresh results exist |
| 15 | Request-changes / reject persistence | Both record to `decisions` + update `decisionStatus`; request-changes blocks approve until fresh analysis |

## P2 — Fixed (where cheap)

| # | Issue | Resolution |
|---|-------|------------|
| 16 | Copilot overriding human decision | `prefer_scenario` rejected when scenario has non-stale approval (EVAL 27) |
| 19 | Save scenario icon-only | Header shows **Save** label on xl breakpoints |

## P2 — Deferred

| # | Issue | Reason |
|---|-------|--------|
| 17 | Prior workspace disappeared | Render free-tier disk (`render.yaml` mounts 1GB at `DATA_DIR`) persists across deploys but **not** across disk loss/expiry; documented — not a list API bug |
| 18 | Greeting / activity timezone leftovers | `formatLocaleDateTime` uses browser locale; server-side reports use ISO fallback when ICU locale unavailable in Node |
| 16 | Copilot collaboration panel | Map-first product — no generic chat panel added; staged proposals + decision tab remain the collaboration surface |

## Tests added

- `src/lib/domain/decision.test.ts`: reason validation, analysis required, stale invalidation, report after recalc, report versioning

## Preserved

- Turf spatial engine
- Provenance chips
- snake_case WebMCP tools (UI hidden unless `NEXT_PUBLIC_SHOW_WEBMCP_UI`)
- Synthetic geography (no OSM/SF tiles)

## Verify locally

```bash
npm test
npm run build
npm run dev
```

Workflow: run analysis → try approve with “ok” (blocked) → approve with substantive reason + confirm dialog → change weights (decision stale) → recalculate → generate report → download markdown → switch scenario (reason scoped) → map-click candidate (evidence syncs).
