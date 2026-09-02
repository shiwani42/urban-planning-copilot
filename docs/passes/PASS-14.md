# Production Hardening Pass 14 — create project 404

Live reference: https://urban-planning-copilot.onrender.com/

## Symptom

On production with a healthy, writable Render disk:

```
POST /api/projects → 400 {"error":"Project not found"}
GET /api/projects → { projects: [], storage: { status: "healthy", onPersistentMount: true } }
GET /api/health → storeExists: true, projectCount: 0
```

The homepage empty-state copy and storage banner implied a missing disk mount even though `/api/health` reported healthy storage.

## Root cause

Pass 12 serialized mutations through a shared `updateChain` promise. When any `updateStore` mutator threw (for example `recordProjectOpen` on a stale workspace URL from browser history, or `renameProject` on a deleted project), the chain rejected and **stayed rejected** for the lifetime of the Node process.

Subsequent `createProject` calls attached to that rejected chain and failed immediately with the **previous** error (`"Project not found"`) without running the create mutator or persisting anything. Disk stayed empty while health checks still reported healthy storage.

Contributing factors:

| Factor | Effect |
|--------|--------|
| `updateChain` rejection | All later writes blocked until process restart |
| Stale workspace `record_open` PATCH | Common trigger — fires on every workspace load, even for missing projects |
| `createProject` post-create `getWorkspace` reload | Extra disk read after write; masked the real failure mode on live |
| Backup recovery calling `persist()` | Could copy a corrupt primary over `.bak` before restore |

## Fixes

| Area | Change |
|------|--------|
| `store.ts` | `updateChain.then(run, run)` so a failed mutation does not poison later writes; chain always settles |
| `store.ts` | `runStoreMutation` uses in-memory store after flush when valid (same `DATA_DIR`) |
| `store.ts` | Backup recovery writes via `writeStorePayload` instead of `persist()` |
| `services.ts` | `createProject` builds workspace from `updateStore` return value; clear error if post-load fails |
| `services.ts` | `recordProjectOpen` no-ops when project is missing (stale link) |
| `seed.ts` | Log seed failures and exit 0 so boot is not blocked |
| `/api/health` | Top-level `status` field for banner gating |
| `StorageBanner` | Show only when `status !== "healthy"`; remove Render mount troubleshooting copy |
| Home / workspace copy | Remove misleading disk-mount instructions |

## Tests

`src/lib/domain/store.test.ts`:

- `createProject` visible via `getStore`, `listProjects`, `getWorkspace`, and `reloadStoreFromDisk`
- Create succeeds after a failed `renameProject` (chain recovery)
- `recordProjectOpen` on missing project does not break create

## Verify

```bash
npm test
npm run build
```

Manual: POST `/api/projects` → 200 with workspace; GET `/api/projects` lists it immediately. Open a stale `/workspace/{id}` URL, then create a new project — should still succeed without restart.
