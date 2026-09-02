/**
 * Launch Chrome with WebMCP + nekuda Workbench extension loaded,
 * open the app, verify tools, and run a deterministic tool journey.
 */
import puppeteer from "puppeteer-core";
import path from "path";
import os from "os";
import fs from "fs";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome-stable";
const EXT = path.join(
  os.homedir(),
  ".config/google-chrome/Default/Extensions/amochnnbmnkjjlblolhpddkokhnalkjp/1.2.2_0"
);

function waitForTools(page, minCount = 1, timeoutMs = 20000) {
  return new Promise((resolve, reject) => {
    const existing = page.webmcp?.tools?.() ?? [];
    if (existing.length >= minCount) return resolve(existing);
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for tools (have ${(page.webmcp?.tools?.() ?? []).length})`));
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
  if (!fs.existsSync(path.join(EXT, "manifest.json"))) {
    throw new Error(`Workbench extension not found at ${EXT}`);
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "upc-chrome-"));
  console.log("Extension path:", EXT);
  console.log("Temp profile:", userDataDir);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: false,
    userDataDir,
    args: [
      "--enable-features=WebMCP,WebMCPTesting",
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1400,900",
    ],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  page.setDefaultTimeout(90000);

  console.log("Opening", `${BASE}/new`);
  await page.goto(`${BASE}/new`, { waitUntil: "networkidle0" });

  if (!page.webmcp) throw new Error("page.webmcp missing");

  const tools = await waitForTools(page, 10);
  console.log(`\n✅ ${tools.length} WebMCP tools visible to browser/agent:`);
  tools.forEach((t) => console.log(`  - ${t.name}`));

  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  const call = async (name, input) => {
    console.log(`\n→ ${name}`);
    const result = await byName[name].execute(input);
    if (result.status !== "Completed") {
      throw new Error(`${name} => ${result.status}: ${result.errorText}`);
    }
    const text =
      typeof result.output === "string"
        ? result.output
        : result.output?.content?.[0]?.text ?? JSON.stringify(result.output);
    console.log("  ", String(text).slice(0, 220));
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  };

  const created = await call("start_planning_project", {
    name: "Workbench Live Check",
    objectiveText:
      "Identify areas for 2,000 additional homes within 800m of transit outside flood-risk areas.",
  });

  await page.goto(`${BASE}/workspace/${created.projectId}`, {
    waitUntil: "networkidle0",
  });
  await waitForTools(page, 10).catch(() => null);
  for (const t of page.webmcp.tools()) byName[t.name] = t;

  await call("get_analysis_plan", { projectId: created.projectId });
  const analysis = await call("run_analysis", {
    projectId: created.projectId,
    scenarioId: created.scenarioId,
  });

  console.log("\n✅ Workbench-capable session ready.");
  console.log("   In the Chrome window: click the nekuda icon / Alt+K to chat.");
  console.log("   DevTools → Application → WebMCP to inspect Available / Invoked tools.");
  console.log(
    `   Workspace: ${BASE}/workspace/${created.projectId} (candidates=${analysis.candidateCount})`
  );
  console.log("\nLeaving Chrome open for 90s so you can try Workbench…");
  await new Promise((r) => setTimeout(r, 90000));
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
