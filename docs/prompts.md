# Demo prompts — Urban Planning Copilot

Live app: https://urban-planning-copilot.heisenbug.in/

Natural-language prompts for judges and demos. **Do not name tools explicitly** — the agent should infer the right operations from context.

## Setup

**Enable WebMCP** (for agent-driven demos):

1. Chrome flag: `chrome://flags/#enable-webmcp-testing` → Enabled → relaunch
2. Or Chrome origin trial: https://developer.chrome.com/blog/ai-webmcp-origin-trial
3. Or ChatGPT in-app browser when WebMCP is available

**Clients tested:** Chrome DevTools, nekuda WebMCP Workbench (Alt+K), ChatGPT, webmcp-evals.

**Rules:**

- No credentials required.
- On **Client Demo SF Housing**, results are pre-warmed — **do not re-run full spatial analysis** on the live deploy.
- Compare only works when **two branches** both have completed, non-stale analysis.
- Approve and report generation require a **human click** in the Decision tab (agent stages; planner confirms).

**Canonical brief (Mission/SoMa, San Francisco):**

> Site 2,000 infill homes within a 10-minute walk of frequent transit, outside high-risk flood, without displacing parks or schools.

---

## Journey A — Independent WebMCP product demo

### Track A1 — Client Demo (~90s, pre-warmed)

Open the live URL once before recording so cold start is not on camera.

| Step | Prompt |
|------|--------|
| 1 | *(Open the app.)* Land on the home dashboard. |
| 2 | Open the **Client Demo SF Housing** study in Mission/SoMa. |
| 3 | Summarize our planning constraints, housing target, and how far eligible capacity is from the 2,000-home goal. Are results current or stale? |
| 4 | Pan the map to the top-ranked site so I can see its neighborhood context. |
| 5 | Add the top-ranked site to the shortlist and tell me why it ranks first. |
| 6 | *(Optional closer)* Start a fresh Mission/SoMa housing study for 2,000 homes with the same constraints. |

**Do not** ask the agent to run or recalculate analysis on Client Demo in production.

### Track A2 — Full product OS (~5–8 min)

| Step | Prompt |
|------|--------|
| 1 | Create a Mission/SoMa, San Francisco housing study for 2,000 additional homes within walking distance of frequent transit, outside high-risk flood zones, without displacing parks or schools. |
| 2 | Before running anything, show me the structured analysis plan and what datasets or limitations apply. |
| 3 | Run the spatial analysis for the active scenario. |
| 4 | List the top candidates and explain why the #1 site is recommended — include metrics and provenance. |
| 5 | Tighten the transit walk threshold to 500 meters and recalculate ranking. |
| 6 | Duplicate the current scenario into a branch named **Climate-first**, then shift priorities toward flood resilience (about 60% flood, 20% transit, 20% capacity) and rerun ranking on that branch. |
| 7 | Compare the baseline branch and Climate-first side by side — eligible capacity, transit access, and overall score. |
| 8 | On whichever branch looks stronger, add the top site to the shortlist. |
| 9 | Open the decision view and record that we want to approve the active scenario as our planning decision. *(Human: type a reason and click Approve in the UI.)* |
| 10 | Generate a planning report for the approved scenario. *(Confirm in UI if prompted.)* |
| 11 | Show me the recent planner decisions and scenario preferences for this study — I want an audit trail. |

**Success check:** reload the project URL — shortlist, active branch, decision, and report state should match what the agent and human did together.

---

## Journey B — With vs without WebMCP

Same planner goal for both arms: complete Track A2 steps 1–10 (or steps 1–8 if time-boxed).

### Arm 1 — Without WebMCP (control)

**Setup:** WebMCP disabled, or a general chat model with no site integration.

**Option A — Human-only:** perform the journey by clicking the UI; no agent.

**Option B — Agent advisory-only:** paste each prompt below, but preface:

> You cannot operate the application — only tell me what to click.

Use the **same prompts** as Track A2 steps 1–10.

**Expected:** instructions only — no live map pan, no shortlist update, no branch switch, no compare table from the agent.

### Arm 2 — With WebMCP (treatment)

**Setup:** WebMCP enabled + nekuda Workbench (Alt+K) or ChatGPT in-app browser on the live URL.

Paste the **identical prompts** from Track A2, one at a time.

**Expected:** each prompt mutates the live workspace — map, results table, scenario header, compare tab, decision status, and activity feed stay in sync without duplicate manual clicks.

### What judges should notice

| Dimension | Without WebMCP | With WebMCP |
|-----------|----------------|-------------|
| State sync | Manual clicks only | Agent + human share one study |
| Evidence | Human reads the UI | Agent cites ranked results + map |
| Branching / compare | Easy to deselect or miss stale branches | Agent should list branches, then compare |
| Trust | N/A | Human gate on approve / report |

---

## Judge quick-start (copy-paste)

> Open https://urban-planning-copilot.heisenbug.in/ — no login. For WebMCP, enable the Chrome flag or use nekuda / ChatGPT with site tools. Start from **Client Demo SF Housing** for a pre-warmed 90s demo (do not re-run analysis). For the full journey, use Track A2 above. Compare two scenarios only after both branches have finished analysis. Approve and report generation require a human click in the Decision tab.
