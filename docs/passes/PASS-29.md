# Production Hardening Pass 29 — move store off git tree

Live reference: https://urban-planning-copilot.onrender.com/

## P0 symptom (live, Sep 2026)

After pass 28’s clobber guard correctly refused an empty catalog (`lastBoot=empty-after-missing-file`), the disk still had **no** `store.json`. Health briefly reported `lastBoot=normal` with `storeReadError: ENOENT`, then 20s later `storeExists: true` / `projectCount: 0` as an empty file appeared. The failsafe seed project is the only survivor and will be lost on the next deploy unless this lands.

## Root cause (smoking gun)

`render.yaml` mounted disk `upc-data` at `/opt/render/project/src/data` and set `DATA_DIR` to that path. The git repo tracks `data/` (`data/ATTRIBUTION.md`, `data/sf/*.geojson.gz`). `store.json` is gitignored.

Every Render deploy checks out/cleans the worktree at `/opt/render/project/src`. That writes committed SF snapshots **into the mount** and **deletes untracked** `store.json` / `store.json.bak` on the persistent volume. Pass 28 then correctly sees a missing file — but the catalog is already gone.

Mounting a persistent disk over a git-tracked directory is unsafe: deploy sync treats untracked files on the mount as disposable.

## Fixes

| Area | Change |
|------|--------|
| `render.yaml` | Disk `upc-data` mount → `/var/data`; `DATA_DIR=/var/data` (Render’s documented pattern) |
| Snapshots | Move `data/sf/` + `data/ATTRIBUTION.md` → `snapshots/sf/` + `snapshots/ATTRIBUTION.md` (not under mount) |
| `sf-data.ts` / ingest | Load/write snapshots from `snapshots/sf/` only |
| Boot migration | On boot, if `DATA_DIR` has no `store.json` but legacy `/opt/render/project/src/data/store.json` (or `.bak`) exists, copy into `/var/data` before any persist; keep legacy file until copy parses |
| Missing store | Do **not** persist an empty catalog on probe/read; `lastBoot=empty-after-missing-file`, status `degraded` |
| Health / projects | Shared `collectStorageDiagnostics()` — `lastBoot` not `normal` on ENOENT; `/api/health` and `/api/projects` agree; write probe never creates `store.json` |
| Seed | Uses `DATA_DIR` only; never writes into `snapshots/sf` |
| Tests | `pass-29.test.ts` — snapshot dir ≠ `DATA_DIR`; persist only under `DATA_DIR`; probe/migration behavior |

## Key files

- `render.yaml` — `/var/data` mount + `DATA_DIR`
- `snapshots/sf/` — git-tracked SF GeoJSON snapshots
- `src/lib/domain/snapshot-paths.ts` — snapshot root helper
- `src/lib/domain/store.ts` — migration, `lastBoot`, no empty bootstrap persist
- `src/lib/domain/storage-diagnostics.ts` — shared health/projects diagnostics
- `src/app/api/health/route.ts` — uses shared diagnostics
- `src/app/api/projects/route.ts` — refuses to list when `store.json` missing
- `scripts/ingest-sf-open-data.mjs` — writes to `snapshots/sf/`

## Verify

```bash
npm test
npm run build
```

Manual (Render):

1. Deploy with new mount path — existing `store.json` on old mount migrates to `/var/data` on first boot.
2. `GET /api/health` — when `store.json` missing: `status: degraded`, `lastBoot: empty-after-missing-file`, `storeExists: false`; no empty file created by probe.
3. `GET /api/projects` — same `storage` block; `projects: []` without marking storage healthy.
4. Create project → `store.json` appears only under `/var/data`; SF layers still load from `snapshots/sf/`.
5. Redeploy — projects survive (disk no longer wiped by git checkout).

## Note on disk mountPath changes

Render Blueprints may reject changing `mountPath` on an existing disk. If deploy fails for that reason, provision a new disk `upc-store` at `/var/data` and retire `upc-data` on `src/data` manually in the Dashboard.
