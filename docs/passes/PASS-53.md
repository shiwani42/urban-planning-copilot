# Pass 53 — Planner-facing copy

Scope: Remove builder/QA/infrastructure strings from planner UI. Live probe study XiBoAdzYqlBYb7VgWvI53 informed default/example naming — no fixture id baked in.

## Changes

| Area | Before | After |
|------|--------|-------|
| Storage banners | DATABASE_URL, Postgres, ephemeral file storage | "This study may not be saved if you leave" |
| Home empty states | Server catalog / storage configuration | Saving issue / saved project list |
| New project examples | Housing growth, Transit, … | Mission/SoMa infill — 2,000 homes, … |
| Geography label | San Francisco — Mission & SoMa demo area | Mission/SoMa, San Francisco |
| Copilot footer | nekuda WebMCP Workbench debug | Planner study hints |
| Server wake | Render free tier | Generic wake message |
| Explore convert names | Explore — transit gap | Transit access gaps — Mission/SoMa |

## Tests

- `src/lib/planner-copy.ts` — centralized strings + forbidden-term guard
- `src/lib/domain/pass-53.test.ts` — regression for renamed/removed strings
- `src/lib/storage-status.test.ts` — banner copy assertion

No Render disks. Stitch visual tokens unchanged.
