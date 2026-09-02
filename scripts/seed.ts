/**
 * Seed demo planning projects into the persistent store.
 * Safe to run multiple times — skips if projects already exist.
 * Failures are logged but do not block application boot.
 */
import { getStore, persist } from "../src/lib/domain/store";
import * as services from "../src/lib/domain/services";

async function main() {
  const store = await getStore();
  if (store.projects.length > 0) {
    console.log(`Store already has ${store.projects.length} project(s) — skipping seed.`);
    return;
  }

  console.log("Seeding demo projects…");

  const northRiver = await services.createProject({
    name: "San Francisco Housing Strategy",
    objectiveText:
      "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.",
    geographyLabel: "San Francisco — Mission & SoMa demo area",
  });

  const projectId = northRiver.project.id;
  const scenarioId = northRiver.project.activeScenarioId!;
  await services.runAnalysis(projectId, scenarioId);

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
  console.log(`Seeded ${final.projects.length} demo projects.`);
  console.log(`Try workspace: /workspace/${projectId}`);
}

main().catch((err) => {
  console.error("Seed failed (boot continues):", err);
  process.exit(0);
});
