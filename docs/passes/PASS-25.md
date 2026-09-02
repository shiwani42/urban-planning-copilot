# Production Hardening Pass 25 — persist recovery

Live reference: https://urban-planning-copilot.onrender.com/

## P0 symptom (live, Sep 2026)

| Signal | Value |
|--------|-------|
| `GET /api/health` | `status: healthy`, `onPersistentMount: true`, `storeExists: true`, `projectCount: 0` |
| `GET /api/projects` | `{ projects: [], storage.status: "healthy" }` |
| Home UI | “Workspace storage unavailable” + localStorage orphan hints |
| Create “SF Housing QA Sep 2026” | Client opened `/workspace/0G8Et_oTbHacB7apQ4t3D` but `run_analysis` → `[NOT_FOUND] Project not found` |
| Seed | `npm run seed && npm start` — seed skips when `projects.length > 0`, otherwise creates 3 demos; failures swallowed (exit 0) |

Root causes:

1. **Health vs banner mismatch** — banner could show on fetch error or stale `unknown` status while `/api/health` reported `healthy` from an earlier in-process mark without a fresh write probe.
2. **Client-only workspace** — copilot `start_planning_project` navigated to `/workspace/:id` without verifying the project was readable from disk; `localStorage` recency hints made orphans look like data loss.
3. **Seed fake-healthy empty store** — boot could persist an empty catalog store, mark healthy, then seed failed silently leaving `projectCount: 0`.
4. **Home empty state** — treated “GET failed” like “studies are gone” when localStorage had hints.

## Fixes

| Area | Change |
|------|--------|
| Write probe | `refreshStorageHealthProbe()` runs on every `/api/health` request; `writeProbeOk` surfaced; status degrades when probe or store read fails |
| `storage-health.ts` | `writeProbeOk` on health records; degraded when probe fails |
| `seed.ts` | Write-probe gate; `reloadStoreFromDisk` before skip; verify `projectCount` after each create; loud `console.error` on failure; never wipe existing store |
| `StorageBanner` | Shared `useStorageStatus` hook; banner only when degraded, probe failed, or health fetch error — never when `healthy` + `writeProbeOk` |
| Home | Orphan hints only when projects loaded successfully, list empty, and storage healthy; fetch errors show retry, not “gone” |
| Create | `/new` and `start_planning_project` verify `GET /api/projects/:id` before navigation |
| Workspace load | Timeout (25s), retry, elapsed/progress copy, manual retry button; map layers retained across refresh |
| Inspector | `describeWorkspaceOutcome` — latest copilot or analysis outcome as one human sentence |

## Key files

- `src/lib/domain/store.ts` — `refreshStorageHealthProbe`, safer empty-store bootstrap
- `src/lib/domain/storage-health.ts` — `writeProbeOk`
- `src/app/api/health/route.ts` — probe + store read on every check
- `scripts/seed.ts` — verify persist, loud failures
- `src/lib/storage-status.ts` — client health hook + banner gating
- `src/components/StorageBanner.tsx` — aligned with health API
- `src/app/page.tsx` — loading vs error vs orphan distinction
- `src/components/workspace-hooks.tsx` — load timeout/retry/progress
- `src/lib/webmcp/register-browser.ts` — verify before navigate
- `src/lib/copilot/workspace-outcome.ts` — inspector sentence
- `src/app/workspace/[projectId]/workspace-client.tsx` — loading UX + inspector outcome

## Verify

```bash
npm test
npm run build
```

Manual:

1. `GET /api/health` — `writeProbeOk: true`, `status` matches storage; `projectCount` matches `GET /api/projects`.
2. Home with healthy storage + empty catalog — no storage banner; orphan copy only when browser hints exist and server list loaded empty.
3. POST `/api/projects` → verify GET lists project → open workspace → `run_analysis` succeeds.
4. Copilot `start_planning_project` on home — navigates only after server confirms project exists.
5. Workspace load — progress phases, elapsed seconds, retry on timeout; map markers stay during refresh.
6. Inspector status line — human sentence for latest analysis or copilot tool run.

No visual redesign. No new datasets. Pass 24 filter/yield-gap/flood UI unchanged.
