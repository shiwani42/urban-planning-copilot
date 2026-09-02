# Production Hardening Pass 15

Scope: Multi-scenario workflow (duplicate + compare), decision tab crash, false 404 overlays, home fetch resilience, and planner-facing polish from live walk on **Pass15 Mission 600 homes**.

Live reference: https://urban-planning-copilot.onrender.com/

## P0/P1 fixes

| Issue | Root cause | Resolution |
|-------|------------|------------|
| Duplicate scenario no-op | `window.prompt` blocked in many browser/embed contexts; failures not surfaced | In-app **Duplicate scenario** modal with name field, success/error toasts, and `create_scenario` error handling |
| Decision tab client crash | `result?.limitations.slice(...)` when `limitations` was undefined on approved scenarios | Safe optional chaining: `(result?.limitations ?? []).slice(...)` |
| Active scenario click “reruns” / home flips to Action required | `activate_scenario` always PATCHed + overwrote `resumeNote` with analysis copy | Client no-op when already active; server no-op + `resumeNoteForScenario` preserves decision notes |
| Home “Unexpected end of JSON input” | `res.json()` on empty/partial bodies | `fetchJsonWithRetry` with empty-body detection, parse guard, retry, human messages |
| False “Project not found” overlay | Full-page 404 when `scenario` missing but `workspace` loaded | Fatal overlay only when project never loads; recoverable scenario picker otherwise; inline error banner when refresh fails but data remains |

## P1/P2 polish

| Issue | Resolution |
|-------|------------|
| Results sheet clips map/legend | Raised drawer z-index (`1010`), dim legend when drawer open, shortlist badge on collapsed tab |
| Report still says Generate when report exists | Button label **Update report** when scenario has reports |
| Title “600 homes” vs objective 2,000 | `objectiveTitleMismatchWarning` chip + banner in objective bar |
| Duplicate failure silent | Toast on validation and API errors |

## Key files

- `src/lib/fetch-json.ts` — resilient JSON fetch + retry
- `src/lib/objective-display.ts` — title vs parsed target mismatch
- `src/lib/domain/services.ts` — `resumeNoteForScenario`, `setActiveScenario` no-op
- `src/components/workspace-hooks.tsx` — hardened workspace load/act
- `src/app/page.tsx` — hardened projects list fetch
- `src/app/workspace/[projectId]/workspace-client.tsx` — duplicate modal, decision guard, layout, toasts
- `src/lib/fetch-json.test.ts`, `src/lib/domain/store.test.ts` — regression tests

## Verification

```bash
npm test
npm run build
```

Manual walk: duplicate Baseline → name branch → run analysis → Compare tab enables with two scenarios; Decision tab loads on approved project; clicking active Baseline does not change home status.

## Out of scope

Shapefile export, sharing/comments, PDF/DOCX, store persistence rework (pass 11/14).
