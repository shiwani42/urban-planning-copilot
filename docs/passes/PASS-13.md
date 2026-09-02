# Pass 13 — Candidate shortlist

Planners cannot act on a 572-row ranking. This pass adds a **scenario shortlist**: pin ranked sites into a small package for decision review.

## What shipped

### Domain

- `Scenario.shortlist` — array of `ShortlistEntry` persisted in `store.json` with the project.
- Each entry stores stable `featureIds` (survives re-analysis id rotation), `label`, `pinnedAt`, optional `reason` (why pinned), and optional one-line `note`.
- Helpers in `src/lib/domain/shortlist.ts` resolve entries against current results and remap after `run_analysis`.
- Rejecting a candidate removes it from the shortlist; re-analysis remaps surviving pins by parcel features.

### UI

- **Results** — pin column (keep icon), shortlist count badge, shortlist panel above the candidates table.
- **Decision** — shortlist panel with count, pin reasons, notes, and unpin.
- **Report** — same shortlist panel; generated reports include a `Candidate shortlist` section.
- **Map** — shortlisted parcels use Human Amber (`#815504`) styling.
- Empty state copy: *Pin sites from Results to build a package for decision.*

### WebMCP

| Tool | Layer | Notes |
|------|-------|-------|
| `list_shortlist` | answer | Returns `count` + `shortlist` entries with rank/score when present |
| `add_to_shortlist` | action | `candidateId`, optional `reason` / `note` |
| `remove_from_shortlist` | action | `candidateId` |

`projectId` / `scenarioId` default from the open workspace. Mutations dispatch `upc:workspace-mutated` so the open UI refreshes without reload.

### API

PATCH actions: `add_to_shortlist`, `remove_from_shortlist`, `update_shortlist_note`.

## Out of scope

Shapefile export, sharing, PDF suite, new city ingest — unchanged from prior passes.

## Verify

```bash
npm test
npm run build
```

Manual: run analysis → pin a few sites on Results → confirm shortlist on Decision and Report → reload page → pins persist → call `add_to_shortlist` / `remove_from_shortlist` via WebMCP and confirm live UI update.
