# Production Hardening Pass 46 — WebMCP agent loop

Scope: WebMCP QA walk fixes — `run_analysis` must move product state, tool failures must not report ok, storage banner honesty on Postgres, reliable `set_map_view`, and geography-safe project bootstrap.

## P0 — Fixed

| Issue | Resolution |
| --- | --- |
| `run_analysis` ok with 0 analyses | Stale running jobs reconciled; in-flight runs polled to completion; completed status requires `candidateCount > 0`; workspace opens Results tab on mutation |
| Tool failures masquerade as success | Browser `execute` returns `{ isError: true }` instead of throwing; `invokeMcpTool` validates `run_analysis` product state |
| `list_candidates` before analysis | Returns structured `NO_ANALYSIS` error (not empty ok) |

## P1 — Fixed

| Issue | Resolution |
| --- | --- |
| Ephemeral storage banner on Postgres | `shouldShowEphemeralStorageBanner` hides when `persistBackend: postgres` and `postgresOk`; file backend shows honest banner |
| `set_map_view` unreliable | `parseMapCenter` accepts `[lng,lat]` arrays and `"lng,lat"` strings; map mutation bus unchanged |

## P2 — Fixed

| Issue | Resolution |
| --- | --- |
| Geography spliced into objective | `resolveObjectiveTextWithGeography` appends only when absent; never splices into existing text |

## Key files

- `src/lib/webmcp/register-browser.ts` — `isError` tool results, product-state validation
- `src/lib/webmcp/server-handlers.ts` — analysis polling, stale job recovery, map center parsing
- `src/lib/webmcp/tool-result.ts` — shared browser tool result helpers
- `src/lib/storage-status.ts` — Postgres-aware banner gating
- `src/components/StorageBanner.tsx` — ephemeral vs unavailable banners
- `src/lib/domain/objective-geography.ts` — objective/geography normalization
- `src/lib/domain/pass-46.test.ts` — regression tests

## Verify

```bash
npm test
```

Agent loop: `start_planning_project` → `run_analysis` → `list_candidates` → `set_map_view` — each step updates persisted state and live UI.
