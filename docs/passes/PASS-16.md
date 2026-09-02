# Production Hardening Pass 16 — write-probe race and empty JSON

Live reference: https://urban-planning-copilot.onrender.com/

## P0 — `.write-probe` ENOENT race

**Symptom:** `run_analysis`, duplicate scenario, and home reload fail with:

```
ENOENT: no such file or directory, unlink '/opt/render/project/src/data/.write-probe'
```

Concurrent requests (health check + `persist` + analysis) shared a single `.write-probe` file. One request unlinked it while another still tried to unlink the same path → ENOENT surfaced as storage failure and blocked real work.

### Fix

| Area | Change |
|------|--------|
| `store.ts` | Unique probe filename per call (`pid` + random suffix) |
| `store.ts` | `safeUnlinkProbe` ignores `ENOENT` on cleanup |
| `store.ts` | Writable check no longer serializes or blocks mutations |

## P0 — Empty / truncated API JSON

**Symptom:** Home “Unexpected end of JSON input”, workspace “empty response from server”, projects vanish after reload.

Unhandled `persist` / storage errors could abort route handlers before `NextResponse.json`, yielding empty bodies despite client `fetchJsonWithRetry`.

### Fix

| Area | Change |
|------|--------|
| `api-route.ts` | `runApiHandler` always returns JSON; storage errors → **503** |
| `/api/projects`, `/api/projects/[id]`, `/api/health` | Wrapped in `runApiHandler` |

## P1 — WebMCP argument parsing

**Symptom:** `add_to_shortlist` missing `candidateId`, `create_scenario_branch` missing `name` despite valid JSON from workbench `executeTool`.

Some clients pass arguments as JSON strings or nested `{ arguments: … }` envelopes.

### Fix

| Area | Change |
|------|--------|
| `webmcp-validation.ts` | `parseToolArguments` unwraps string JSON + `arguments`/`args`/`input`/`params` |
| `server-handlers.ts` | Explicit `name` validation on `create_scenario_branch` |
| Context defaults | Unchanged — `projectId` / `scenarioId` from open workspace via `tool-context` |

## P1 — Transit meters revert on blur

**Symptom:** Typing `900` reverted to `800` on blur.

`onBlur` cleared the draft before async `commitTransitThreshold` finished, so the input fell back to stale `c.value`. `onFocus` also overwrote in-progress drafts.

### Fix

| Area | Change |
|------|--------|
| `workspace-client.tsx` | Keep draft through commit; set normalized meters on commit |
| `workspace-client.tsx` | `onFocus` preserves existing draft; no delete-on-blur |

## Duplicate scenario modal

Pass 15 shipped the in-app duplicate modal (no `window.prompt`). Pass 16 does not change that UI — live failures were caused by the write-probe race aborting `create_scenario` before the modal could succeed.

## Tests

- `store.test.ts` — concurrent `verifyWritableDataDir` does not throw; `updateStore` after legacy probe unlink
- `webmcp.test.ts` — nested `arguments` envelope for `add_to_shortlist`; JSON string for `create_scenario_branch`

## Verify

```bash
npm test
npm run build
```

Manual: run analysis while `/api/health` polls → no ENOENT banner; duplicate scenario via modal → branch created; edit transit to 900 m → value sticks after blur; WebMCP workbench `add_to_shortlist` / `create_scenario_branch` with workspace open.

## Out of scope

Render disk removal, store rewrite, shapefile export, sharing/comments.
