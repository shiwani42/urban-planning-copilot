# Production hardening pass 28: never clobber store on boot

Live reference: https://urban-planning-copilot.onrender.com/

## P0 symptom (live, Sep 2026 — deploy pass 26 → 28)

| Signal | Value |
|--------|-------|
| Mid-session | Home listed project; workspace loaded with shortlist + decision |
| `GET /api/projects` | `{ projects: [] }` while `storage.healthy`, `onPersistentMount: true`, `writeProbeOk: true` |
| `GET /api/projects/:id` | 404 for previously open project |
| Create button | No-op; `POST /api/projects` → 400 `Cannot read properties of undefined (reading 'trim')` |
| After deploy finished | New POST succeeded; prior study gone; `projectCount: 1` |

Root cause (verified in `store.ts`): when both `store.json` and `store.json.bak` are missing, boot called `buildDefaultStore()` then `persist()`, writing an empty catalog to the persistent disk. On Render, `/opt/render/project/src` is replaced every deploy; the disk remounts at `DATA_DIR=/opt/render/project/src/data`. If seed or first `getStore()` runs before `store.json` is visible, boot clobbers the real catalog. `writeProbeOk` stays true because writing empty succeeded.

## Fixes

| Area | Change |
|------|--------|
| `readStoreFromDisk` | Retry missing files (2s / 3s / 5s) before concluding first-run; restore from `.bak` when it appears after delay; **never** persist empty default on persistent mount or when prior catalog evidence exists |
| `persist` / `writeStorePayload` | Hard guard: refuse to replace disk catalog with N>0 projects using payload with 0 projects (`allowEmptyCatalog` only for tests / explicit wipe) |
| `waitForStableStoreRead` | Seed waits for stable disk read; never treats first-tick ENOENT as empty catalog |
| `createProject` | Guard all request fields before `.trim()`; human 400 messages for missing name/objective |
| Workspace load | Immediate stale/not-found screen on 404 with Retry (spinner + timestamp) + Home |
| `/api/health` | Expose `lastBoot`: `first-run` \| `recovered-backup` \| `empty-after-missing-file` \| `normal` |
| Home | Banner when `lastBoot === empty-after-missing-file` — catalog may have reset after deploy |
| Footer | `N ANALYSES` counts completed results (0/1), not pipeline plan steps |

## Key files

- `src/lib/domain/store.ts` — mount retries, clobber guard, `lastBoot`, `waitForStableStoreRead`
- `src/lib/domain/storage-health.ts` — `lastBoot` on health records
- `src/lib/domain/services.ts` — validated `createProject` inputs
- `scripts/seed.ts` — stable disk read before seeding
- `src/app/api/health/route.ts` — `lastBoot` in storage block
- `src/components/workspace-hooks.tsx` — 404 detection, retry timestamp
- `src/app/workspace/[projectId]/workspace-client.tsx` — not-found UX, honest analysis count
- `src/app/page.tsx` — deploy reset banner
- `src/lib/domain/store.test.ts` — clobber guard + persistent-mount boot test

## Verify

```bash
npm test
npm run build
```

Manual:

1. Simulate missing `store.json` on persistent `DATA_DIR` during boot — server must not write empty catalog; health shows `lastBoot: empty-after-missing-file`.
2. With existing projects on disk, attempt to persist empty store — must fail with clobber error; disk unchanged.
3. `POST /api/projects` with `{}` → 400 with human validation message (not TypeError).
4. Open workspace; delete project server-side; client shows not-found banner immediately with working Retry.
5. Footer shows `0 ANALYSES` before first run, `1 ANALYSES` after completed analysis.
