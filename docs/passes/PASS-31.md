# Deploy survive check: Pass30 Persist Probe

Live reference: https://urban-planning-copilot.onrender.com/

## Purpose

Deploy-survive check after pass 30 `data/.gitkeep`. This pass adds documentation only — no application code changes. It confirms that a project created before this deploy still appears after Render restarts.

## Live probe (must survive this deploy)

| Field | Value |
|-------|-------|
| Project id | `mYMuj0F13CNrWBOGi2ia7` |
| Name | Pass30 Persist Probe |

This probe **must still exist** after this deploy completes and the service restarts.

## Storage (unchanged)

| Setting | Value |
|---------|-------|
| Disk mount path | `/opt/render/project/src/data` |
| `DATA_DIR` | `/opt/render/project/src/data` (unchanged from pass 30) |

Pass 29’s `/var/data` move is still deferred. Do not change mount path or `DATA_DIR` for this check.

## Success criteria

After Render finishes deploy and restarts:

```bash
curl -s https://urban-planning-copilot.onrender.com/api/projects
```

Response `projects` must include id `mYMuj0F13CNrWBOGi2ia7` (name **Pass30 Persist Probe**).

If the probe is missing, pass 30’s `data/.gitkeep` fix did not prevent deploy checkout from wiping the persistent catalog.
