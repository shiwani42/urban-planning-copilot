# Production Hardening Pass 17 — analysis must not wipe the store

Live reference: https://urban-planning-copilot.onrender.com/

## Symptom

After creating/duplicating a project and running analysis on a second scenario, the workspace store reported healthy storage but **zero projects**:

```
GET /api/health → status: healthy, onPersistentMount: true, storeExists: true, projectCount: 0
GET /api/projects → []
```

Browser `localStorage` still remembered recent project names, but the server store was empty.

## Hypothesis (verified)

`run_analysis` persisted ~572 candidates, each carrying a full parcel **geometry** and heavy **provenance** blob duplicated from `featuresByDataset`. On a Render free instance this inflated `store.json` dramatically:

| Component | Approx. impact |
|-----------|----------------|
| 572 × polygon geometry in `analysisResults` | Tens of MB duplicated from parcels catalog |
| Per-candidate provenance (calculations, breakdowns) | Additional MB per analysis |
| Second scenario analysis | Another full candidate set appended |

`JSON.stringify` + write could exhaust memory or produce a write failure. The previous `writeStorePayload` copied the **primary file to `.bak` before validating the new tmp file**, so a truncated/corrupt primary could overwrite a good backup. After restart, recovery had nothing usable and the catalog-only empty store appeared “healthy.”

This is **not** the pass-16 write-probe race or pass-14 poisoned `updateChain`.

## Fixes

| Area | Change |
|------|--------|
| `store-persistence.ts` | **Compact** analysis results for disk: `id`, `score`, `rank`, `featureIds`, `metrics`, `status` — no geometries or per-candidate provenance |
| `store-persistence.ts` | **Hydrate** geometries from `featuresByDataset` parcels on read |
| `store.ts` | **Fsync-safe persist**: write `.tmp` → `fsync` → parse-validate → backup only parseable primary → atomic `rename` → backup new primary |
| `store.ts` | Never copy a file that fails JSON parse onto `.bak` |
| `store.ts` | On persist failure, reload disk into memory so in-flight mutations do not poison RAM |
| `services.ts` | `runAnalysis` catches `StorePersistError`, marks job failed, returns `{ persistError: { code: "RESULTS_NOT_SAVED" } }` — **projects/scenarios stay intact** |
| Compare tab | Inline **Run** for scenarios missing analysis |
| Workspace UI | Show **analyzed** when fresh results exist; clear stale “analysis in progress” on scenario switch |
| Workspace UI | Only show running spinner when the **active** scenario has a running job |

## Store size guidance

On Render free (512 MB RAM), keep `store.json` **under ~50 MB** after compaction. Before pass 17, two full analyses with geometries could exceed **100 MB** and risk OOM during stringify.

Measure locally:

```bash
node -e "
const { estimateStoreJsonBytes } = require('./dist/...'); // or import in a script
"
```

Or inspect `wc -c $DATA_DIR/store.json` on the instance. Catalog data (`featuresByDataset`) dominates baseline size; candidate rows should add **kilobytes**, not megabytes, per analysis.

## Tests

`src/lib/domain/store.test.ts`:

- Compact persist: disk JSON has no candidate `"geometry"`; reload hydrates geometry for map use
- Two scenarios, both analyzed, `reloadStoreFromDisk` → `projectCount === 1`, both results present
- Injected persist failure → next `getStore()` still has the project

## Verify

```bash
npm test
npm run build
```

Manual: duplicate scenario → run analysis on both → reload home → project still listed; `/api/health` `projectCount >= 1`.
