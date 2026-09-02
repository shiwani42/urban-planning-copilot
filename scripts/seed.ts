/**
 * Seed demo planning projects into the persistent store.
 * Safe to run multiple times — skips if projects already exist.
 * Failures are logged loudly; boot continues but storage is marked degraded.
 */
import { promises as fs } from "fs";
import {
  getStore,
  getStorePath,
  persist,
  reloadStoreFromDisk,
  refreshStorageHealthProbe,
} from "../src/lib/domain/store";
import * as services from "../src/lib/domain/services";

const EXPECTED_DEMO_PROJECTS = 3;

async function verifyPersistedProjectCount(minimum: number): Promise<number> {
  const store = await reloadStoreFromDisk();
  const count = store.projects.length;
  if (count < minimum) {
    throw new Error(
      `Seed verification failed: expected at least ${minimum} project(s) on disk, found ${count} at ${getStorePath()}`
    );
  }
  return count;
}

async function main() {
  const health = await refreshStorageHealthProbe();
  if (health.writeProbeOk === false) {
    console.error(
      "[seed] ABORT — data directory is not writable:",
      health.message ?? health.dataDir
    );
    process.exit(0);
  }

  const store = await reloadStoreFromDisk();
  if (store.projects.length > 0) {
    console.log(`[seed] Store already has ${store.projects.length} project(s) — skipping seed.`);
    return;
  }

  console.log("[seed] Seeding demo projects…");

  const northRiver = await services.createProject({
    name: "San Francisco Housing Strategy",
    objectiveText:
      "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.",
    geographyLabel: "San Francisco — Mission & SoMa demo area",
  });

  const projectId = northRiver.project.id;
  const scenarioId = northRiver.project.activeScenarioId!;
  await verifyPersistedProjectCount(1);

  try {
    await services.runAnalysis(projectId, scenarioId);
  } catch (err) {
    console.error(
      "[seed] WARNING — demo analysis failed (projects are still saved):",
      err instanceof Error ? err.message : String(err)
    );
  }

  await services.createProject({
    name: "East Side Commercial Zone",
    objectiveText:
      "Identify mixed-use rezoning opportunities that maximize density while maintaining transit access and avoiding high flood-risk areas.",
    geographyLabel: "San Francisco — Mission District",
  });

  await services.createProject({
    name: "Transit Hub Expansion",
    objectiveText:
      "Find neighborhoods with the largest transit accessibility gaps and identify candidate locations for new transit-oriented development.",
    geographyLabel: "San Francisco transit corridors",
  });

  const final = await getStore();
  await persist(final);
  const count = await verifyPersistedProjectCount(EXPECTED_DEMO_PROJECTS);
  console.log(`[seed] Seeded ${count} demo projects at ${getStorePath()}`);
  console.log(`[seed] Try workspace: /workspace/${projectId}`);
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("[seed] FAILED — boot continues but workspace may be empty:", message);
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
  try {
    const storePath = getStorePath();
    const raw = await fs.readFile(storePath, "utf8").catch(() => "");
    if (raw.trim()) {
      const parsed = JSON.parse(raw) as { projects?: unknown[] };
      const count = Array.isArray(parsed.projects) ? parsed.projects.length : 0;
      console.error(`[seed] store.json exists with ${count} project(s) — not wiping existing data.`);
    }
  } catch {
    /* ignore secondary diagnostics */
  }
  await refreshStorageHealthProbe();
  process.exit(0);
});
