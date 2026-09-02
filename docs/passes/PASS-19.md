# Production Hardening Pass 19 — Explore convert and branch status

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — Explore convert → Create workspace silent no-op

**Symptom:** After scratch investigation, **Convert to planning project →** then **Create workspace** appeared to do nothing — no loading, error, or navigation.

### Fix

| Area | Change |
|------|--------|
| `explore/page.tsx` | Convert is a button with loading state; saves draft to `sessionStorage` and `router.push("/new?from=explore")`; surfaces storage/navigation errors |
| `new/page.tsx` | Validates `project.id` in API response; `await router.push`; human-readable errors when create or navigation fails |

## P0 — Scenario branch inherits parent decision

**Symptom:** New branch showed **Decision recorded: Approved** and stale `resumeNote` while analysis said **No results yet**.

`createScenario` only updated `resumeNote` when `fromScenarioId` was explicitly passed; WebMCP branches defaulting to the active scenario left the parent’s decision note on the project.

### Fix

| Area | Change |
|------|--------|
| `services.ts` | Always set branch `resumeNote` to a no-analysis message; never copy parent decision text |
| `resumeNoteForScenario` | Returns **No analysis yet — run analysis for this scenario.** when there is no completed result |
| `workspace-client.tsx` | Header badge derives from **active scenario** decision/result state, not stale `project.resumeNote` |
| `server-handlers.ts` | `create_scenario_branch` returns `note` + `message` that analysis/decision were not copied |
| UI duplicate modal | Toast confirms analysis and decision were not copied |

## P0 — Map paints all parcels before analysis

**Symptom:** Branched scenario with zero results still showed dense parcel fill.

### Fix

| Area | Change |
|------|--------|
| `PlanningMap.tsx` | Hide parcel candidate layer when `candidates.length === 0`; basemap + empty-state overlay |

## P1 — Candidate labels

**Symptom:** Top recommendation and tables showed raw parcel ids (e.g. `3595006`).

### Fix

| Area | Change |
|------|--------|
| `candidate-label.ts` | `candidateLabelFromFeature` — neighborhood + blklot / block labels |
| `spatial.ts` | Uses human labels for all ranked candidates |

## P1 — Scratch results pagination

**Symptom:** Only 15 of 703 areas listed with no way to see more.

### Fix

| Area | Change |
|------|--------|
| `explore.ts` | `candidateRows` — full ranked list (metrics only, no geometry) |
| `explore/page.tsx` | **Show N more** / **Show top 15 only**; footer **Showing X of Y areas** |

## P1 — WebMCP schema + shortlist message

| Area | Change |
|------|--------|
| `webmcp/schema.json` | Property descriptions on `create_scenario_branch` `projectId` and `name` |
| `server-handlers.ts` | `list_shortlist` returns `message`, `candidateIds`, and `count` |

## P2 — Caveats and breadcrumbs

| Area | Change |
|------|--------|
| `explore/page.tsx` | Show up to 8 severity-sorted caveats (was 5) |
| `workspace-client.tsx` | Breadcrumb segments use `max-w` + `title` instead of aggressive `truncate` |

## Tests

- `candidate-label.test.ts` — neighborhood/blklot labels
- `store.test.ts` — branch does not inherit parent decision/resume note
- `shortlist.test.ts` — `list_shortlist` message includes count + ids
- `explore.test.ts` — `candidateRows` length matches total candidates

## Verify

```bash
npm test
npm run build
```

Manual: Explore housing siting → Convert (loading) → Create workspace → lands in new project; duplicate/branch scenario via WebMCP → **No analysis yet** badge, empty map until **Run analysis**; scratch table **Show more**; top rec shows neighborhood/blklot label.
