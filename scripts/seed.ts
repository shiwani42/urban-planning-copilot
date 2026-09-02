/**
 * Seed demo planning projects into the persistent store.
 * Safe to run multiple times — skips if projects already exist.
 */
import { getStore, persist } from "../src/lib/domain/store";
import * as services from "../src/lib/domain/services";

async function main() {
  const store = await getStore();
  if (store.projects.length > 0) {
    console.log(`Store already has ${store.projects.length} project(s) — skipping seed.`);
    process.exit(0);
  }

  console.log("Seeding demo projects…");

  const northRiver = await services.createProject({
    name: "North River Housing Strategy",
    objectiveText:
      "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.",
    geographyLabel: "North River study area",
  });

  const projectId = northRiver.project.id;
  const scenarioId = northRiver.project.activeScenarioId!;
  await services.runAnalysis(projectId, scenarioId);

  await services.createProject({
    name: "East Side Commercial Zone",
    objectiveText:
      "Identify mixed-use rezoning opportunities that maximize density while maintaining transit access and avoiding high flood-risk areas.",
    geographyLabel: "East Side corridor",
  });

  await services.createProject({
    name: "Transit Hub Expansion",
    objectiveText:
      "Find neighborhoods with the largest transit accessibility gaps and identify candidate locations for new transit-oriented development.",
    geographyLabel: "Metro expansion area",
  });

  const final = await getStore();
  await persist(final);
  console.log(`Seeded ${final.projects.length} demo projects.`);
  console.log(`Try workspace: /workspace/${projectId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
