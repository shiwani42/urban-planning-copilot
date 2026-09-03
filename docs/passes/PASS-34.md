# Production hardening pass 34: Postgres catalog on Render free

## Problem

Render **free** web services do not get a usable persistent disk. The catalog lived in `store.json` under the git worktree (`/opt/render/project/src/data`). Every GitHub auto-deploy overlays that path and deletes untracked `store.json` / `.bak` files. Health could report `onPersistentMount: true` while the catalog was already gone.

## Fix

When **`DATABASE_URL`** is set (Neon pooled Postgres URI), the compact catalog JSON is the durable source of truth in a single-row `planning_store` table (`id = 'default'`, `payload jsonb`). `store.json` remains a local/dev fallback and optional on-disk cache only.

## Render setup

1. Create a free [Neon](https://neon.tech) project (or another claimable Postgres).
2. Copy the **pooled** connection string (`-pooler` hostname).
3. In the Render Dashboard for **urban-planning-copilot**, add env var **`DATABASE_URL`** (sync: false — never commit the URI).
4. **Claim** the Neon database so it does not expire on the free tier.
5. Redeploy. Studies and projects survive deploys even when `store.json` is missing from the ephemeral filesystem.

`render.yaml` keeps `plan: free` and declares `DATABASE_URL` with `sync: false`. No Render Postgres add-on (paid) is required.

## Health

`/api/health` storage block includes:

- `persistBackend`: `"postgres"` | `"file"`
- `postgresOk`: probe result when Postgres is configured
- `writeProbeOk`: reflects the active backend (Postgres upsert probe or file write probe)

Missing `store.json` alone does **not** degrade health when Postgres holds the catalog.

## Local dev

Without `DATABASE_URL`, behavior is unchanged (`DATA_DIR/store.json`). Set `DATABASE_URL` in `.env.local` to test Postgres locally.
