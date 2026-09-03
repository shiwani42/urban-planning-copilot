# Production hardening pass 34: Postgres catalog on Render free

## Problem

Render **free** web services do not get a usable persistent disk. The catalog lived in `store.json` under the git worktree (`/opt/render/project/src/data`). Every GitHub auto-deploy overlays that path and deletes untracked `store.json` / `.bak` files. Health could report `onPersistentMount: true` while the catalog was already gone.

## Fix

When **`DATABASE_URL`** is set (Neon pooled Postgres URI), the compact catalog JSON is the durable source of truth in a single-row `planning_store` table (`id = 'default'`, `payload jsonb`). `store.json` remains a local/dev fallback and optional on-disk cache only.

## Render setup

Production Neon project: **`falling-darkness-05470105`** (claimed; use the **`production`** branch). Do not use the earlier unclaimed `damp-sea-35723814` neon.new project.

1. From the Neon console for **falling-darkness-05470105**, copy the **pooled** connection string for the **`production`** branch (`-pooler` hostname).
2. In the Render Dashboard for **urban-planning-copilot**, set env var **`DATABASE_URL`** to that URI (`sync: false` in `render.yaml` — never commit the URI).
3. Redeploy. Studies and projects survive deploys even when `store.json` is missing from the ephemeral filesystem.

`render.yaml` keeps `plan: free` and declares `DATABASE_URL` with `sync: false`. No Render Postgres add-on (paid) is required. Repo root `neon.ts` (`@neon/config`) documents the Neon project policy; connection strings stay in Render env only.

## Health

`/api/health` storage block includes:

- `persistBackend`: `"postgres"` | `"file"`
- `postgresOk`: probe result when Postgres is configured
- `writeProbeOk`: reflects the active backend (Postgres upsert probe or file write probe)

Missing `store.json` alone does **not** degrade health when Postgres holds the catalog.

## Local dev

Without `DATABASE_URL`, behavior is unchanged (`DATA_DIR/store.json`). Set `DATABASE_URL` in `.env.local` to test Postgres locally.
