# Production hardening pass 30: stop git wiping the disk

Live reference: https://urban-planning-copilot.onrender.com/

## P0 symptom (live, Sep 2026 — pass 29 merged, disk did not move)

| Signal | Value |
|--------|-------|
| Pass 29 (#30) merged | Code shipped via GitHub auto-deploy |
| Render disk | Still mounted at `/opt/render/project/src/data` — **not** `/var/data` |
| Health | `dataDir=/opt/render/project/src/data`, `lastBoot=empty-after-missing-file` |
| `store.json` | ENOENT — catalog gone |
| Failsafe seed | Only survivor; real projects 404 |

Pass 29 correctly moved SF snapshots to `snapshots/sf/` and removed `data/sf/` from git. That also removed the last tracked path under `data/`. On deploy, Render checks out the repo into `/opt/render/project/src`, which **deletes untracked files** under directories git no longer tracks — including `store.json` and `store.json.bak` on the persistent volume mounted at `data/`.

Changing `disk.mountPath` and `DATA_DIR` in `render.yaml` does **not** apply on GitHub auto-deploy alone. Someone must set **Disk mount path** and **`DATA_DIR`** in the Render Dashboard (or run a Blueprint sync that accepts the change). Until then, production keeps the legacy mount at `src/data`.

## Fixes

| Area | Change |
|------|--------|
| `data/.gitkeep` | Tracked placeholder so git always recreates `data/` on deploy and never treats the mount as an empty deleted tree |
| `.gitignore` | Still ignores `data/store.json` and `data/*.bak` only — not the whole `data/` folder |
| `storage-mount.ts` | `resolveDataDir()` honors `process.env.DATA_DIR` for non-`/var/data` paths; uses `/var/data` only when `findmnt`/stat proves a real writable mount; otherwise falls back to legacy `src/data` when that path is mounted |
| `store.ts` | Boot searches `store.json.bak` across `DATA_DIR`, legacy `src/data`, and `/var/data`; restores when found; still refuses to clobber when truly gone (`lastBoot=empty-after-missing-file`) |
| `storage-health.ts` | Default persistent prefix back to legacy `src/data`; both legacy and `/var/data` count as persistent |
| Tests | `pass-30.test.ts` — `.gitkeep` present; no silent `/var/data` when unmounted; persist under resolved `DATA_DIR` |

## Key files

- `data/.gitkeep` — prevents deploy checkout from wiping the disk mount
- `src/lib/domain/storage-mount.ts` — mount detection + `resolveDataDir()`
- `src/lib/domain/store.ts` — cross-path backup restore, cached resolved dir
- `src/lib/domain/storage-health.ts` — persistent mount prefixes
- `docs/passes/PASS-30.md` — this note

## Render Dashboard action (required for pass 29 mount move)

Until completed, keep `DATA_DIR=/opt/render/project/src/data` aligned with the live disk. To adopt `/var/data`:

1. Open the web service → **Disks** → set mount path to `/var/data` (or provision a new disk there).
2. Set env var **`DATA_DIR=/var/data`** to match.
3. Redeploy. Boot migration copies `store.json` from the legacy path when present.

`render.yaml` alone does not retarget an existing disk on auto-deploy.

## Verify

```bash
npm test
npm run build
```

Manual:

1. After deploy with `data/.gitkeep`, redploy must not delete `store.json` on the `src/data` mount.
2. With `store.json` missing but `.bak` on legacy or current mount, boot restores catalog (`lastBoot=recovered-backup`).
3. With both missing on a persistent mount, health shows `lastBoot=empty-after-missing-file` and no empty catalog is written.
4. When `DATA_DIR=/var/data` but that path is not a mount, resolved dir stays on legacy `src/data` (not ephemeral `/var/data`).
