/**
 * Exercise live browser WebMCP tools against the local app via Puppeteer.
 * Chrome 151+ with --enable-features=WebMCP
 *
 * Usage: node scripts/exercise-webmcp.mjs
 */
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome-stable";

function waitForTools(page, minCount = 1, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const existing = page.webmcp?.tools?.() ?? [];
    if (existing.length >= minCount) {
      resolve(existing);
      return;
    }
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for WebMCP tools (have ${(page.webmcp?.tools?.() ?? []).length})`
        )
      );
    }, timeoutMs);
    page.webmcp.on("toolsadded", () => {
      const tools = page.webmcp.tools();
      if (tools.length >= minCount) {
        clearTimeout(timer);
        resolve(tools);
      }
    });
  });
}

async function main() {
  console.log("Launching Chrome with --enable-features=WebMCP …");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--enable-features=WebMCP",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(90000);

  page.on("console", (msg) => {
    if (msg.type() === "error") console.log("  [page error]", msg.text());
  });

  console.log("Opening", `${BASE}/new`);
  await page.goto(`${BASE}/new`, { waitUntil: "networkidle0" });

  if (!page.webmcp) {
    throw new Error("page.webmcp is missing — Chrome WebMCP CDP not available");
  }

  console.log("Waiting for page tools to register…");
  const tools = await waitForTools(page, 5, 20000);
  console.log(`Discovered ${tools.length} tools:`);
  for (const t of tools) {
    console.log(`  - ${t.name}: ${t.description.slice(0, 80)}`);
  }

  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));

  async function call(name, input) {
    const tool = byName[name];
    if (!tool) throw new Error(`Missing tool: ${name}`);
    console.log(`\n→ ${name}`, JSON.stringify(input));
    const result = await tool.execute(input);
    console.log(`  status=${result.status}`);
    if (result.status !== "Completed") {
      console.log("  error:", result.errorText ?? result.exception);
      throw new Error(`Tool ${name} failed: ${result.status}`);
    }
    const out = result.output;
    const text =
      typeof out === "string"
        ? out
        : out?.content?.[0]?.text ?? JSON.stringify(out);
    console.log("  output:", String(text).slice(0, 500));
    return typeof text === "string" ? safeJson(text) ?? text : out;
  }

  function safeJson(s) {
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  // Journey: create → plan → analyze → inspect → tighten transit → branch
  const created = await call("start_planning_project", {
    name: "Workbench Housing Eval",
    objectiveText:
      "Identify areas for 2,000 additional homes within 800m of transit, outside high-risk flood zones, respecting residential zoning.",
  });
  const projectId = created.projectId;
  const scenarioId = created.scenarioId;
  console.log("\nCreated", { projectId, scenarioId, intent: created.intent });

  // Navigate to workspace so UI state stays coherent for co-browsing
  await page.goto(`${BASE}/workspace/${projectId}`, { waitUntil: "networkidle0" });
  await waitForTools(page, 5, 20000).catch(() => page.webmcp.tools());

  // Refresh tool handles after navigation
  const tools2 = page.webmcp.tools();
  for (const t of tools2) byName[t.name] = t;

  await call("get_analysis_plan", { projectId });
  const analysis = await call("run_analysis", { projectId, scenarioId });
  const candidates = await call("list_candidates", { projectId, scenarioId, limit: 5 });

  const topId =
    analysis?.top?.id ??
    candidates?.candidates?.[0]?.id ??
    null;
  if (topId) {
    await call("inspect_candidate", { projectId, candidateId: topId, scenarioId });
    await call("select_candidate", { projectId, candidateId: topId });
  }

  await call("set_transit_threshold", { projectId, scenarioId, meters: 500 });
  await call("run_analysis", { projectId, scenarioId });

  await call("list_datasets", {});

  console.log("\n✅ Browser WebMCP journey completed successfully.");
  await browser.close();
}

main().catch(async (err) => {
  console.error("\n❌", err);
  process.exit(1);
});
