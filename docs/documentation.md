Documentation
webmachinelearning/webmcp (https://github.com/webmachinelearning/webmcp) on GitHub — Specification source, explainers, and open issues.

WebMCP developer documentation( https://developer.chrome.com/docs/ai/webmcp) — official documentation from Google.

WebMCP origin trial(https://developer.chrome.com/blog/ai-webmcp-origin-trial) — instructions for enabling WebMCP in Chrome.

WebMCP tool security guide (https://developer.chrome.com/docs/ai/webmcp/secure-tools) — Guidance on prompt-injection risks and trust boundaries.

 

 Other tools:

5 resources:

1/ Our Chrome extension to debug your WebMCP implementation and experience it as an end-user. See your tools, create evals, and test your site with an agent. Batteries included or bring your own key.
https://chromewebstore.google.com/detail/nekuda-webmcp-workbench/amochnnbmnkjjlblolhpddkokhnalkjp

2/ 
@googledevs
 WebMCP Evals CLI is a great toolkit for testing your tools, tool calling, and full agent workflows.
https://github.com/GoogleChromeLabs/webmcp-tools/tree/main/webmcp-evals

3/ Check out other WebMCP implementations on http://WebMCP.com for inspiration. We also have an API for agents, so they can explore the directory autonomously and get inspired by other implementations.

4/ Our guide for building great agent journeys from first principles.
https://webmcp.com/blog/building-user-journeys-with-webmcp

5/ Want to find more WebMCP resources? Check out the resources section on http://webmcp.com for articles, technical documentation, and more. https://webmcp.com/resources

---

## How this repo uses the above

Implementation notes live in `webmcp/README.md`.

- **Browser tools** register via `document.modelContext.registerTool` in `src/lib/webmcp/register-browser.ts`.
- Tools are designed as **Answer / Action / Sensitive** journey steps toward an auditable planning decision — not one-tool-per-API-endpoint.
- Sensitive tools call `requestUserInteraction()` so the human planner confirms approvals/rejections.
- **Eval fixtures** for `webmcp-evals` are in `webmcp/schema.json` and `webmcp/evals.json`.
- **HTTP bridge** at `/api/mcp` supports CI/headless checks against the same domain services.
- Security annotations: `readOnlyHint`, `untrustedContentHint`, `destructiveHint` per the Chrome security guide.



Google Chrome

WebMCP Explainer(https://github.com/webmachinelearning/webmcp/blob/main/README.md) — Understand the API design and specification.

WebMCP evals (https://developer.chrome.com/docs/ai/webmcp/evals) — Test your WebMCP tools before you ship.

Debug WebMCP tools (https://developer.chrome.com/docs/devtools/application/webmcp) — Inspect and debug registered tools in Chrome DevTools.

Modern Web Guidance (https://github.com/GoogleChrome/modern-web-guidance) — Use the WebMCP skill when building with coding agents.

---

## Chrome DevTools + evals (this product)

### DevTools Application → WebMCP pane

On `http://localhost:3000` (or any workspace page):

1. Open DevTools → **Application** → **WebMCP**
2. Confirm **Available tools** lists the 18 planning tools (`start_planning_project`, `run_analysis`, …)
3. Use **Run tool** for deterministic manual invocation (no LLM)
4. Watch **Invoked tools** for status / input / output while using nekuda Workbench (Alt+K)

### Probabilistic + deterministic eval strategy

Per https://developer.chrome.com/docs/ai/webmcp/evals:

| Layer | What we use |
| --- | --- |
| Isolation / schema | `webmcp/schema.json` + `npx webmcp-evals local` |
| Deterministic browser | `npm run eval:webmcp:browser` (Puppeteer + `--enable-features=WebMCP`) |
| Agent journeys | `webmcp/evals.json` — includes ordered multi-step `expectedCall` chains |
| Co-browsing UX | nekuda Webbench against live page tools |

### Failure modes we guard against

- Wrong tool / wrong order → journey-shaped names + descriptions; eval `expectedCall` sequences
- Wrong arguments → tight `inputSchema`, `additionalProperties: false`, enums where useful
- Sensitive mid-chain mistakes → `requestUserInteraction()` on approve/reject/prefer/report
- Forbidden actuation → HTTP MCP rejects `executeSQL` / `clickButton` / DOM tools

### Quick commands

```bash
npm run dev
npm run eval:webmcp:browser
npm run eval:webmcp:local
# With Workbench: open http://localhost:3000/new → Alt+K → ask a planning question
```
