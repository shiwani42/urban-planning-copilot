import * as turf from "@turf/turf";
import { STUDY_BOUNDS } from "./study-bounds";

function polygonGeometry(index: number): GeoJSON.Polygon {
  const { west, south, east, north } = STUDY_BOUNDS;
  const cols = 40;
  const rows = 40;
  const dx = (east - west) / cols;
  const dy = (north - south) / rows;
  const r = Math.floor(index / cols);
  const c = index % cols;
  const w = west + c * dx;
  const s = south + r * dy;
  return turf.bboxPolygon([w, s, w + dx * 0.9, s + dy * 0.9]).geometry as GeoJSON.Polygon;
}

/** Bloated pre-Pass-49 store JSON with inline parcel polygons on every candidate. */
export function bloatedStoreFixture(candidateCount: number): string {
  const candidates = Array.from({ length: candidateCount }, (_, i) => ({
    id: `cand-${i}`,
    label: `Parcel ${i}`,
    featureIds: [`parcel-${i}`],
    geometry: polygonGeometry(i),
    centroid: [-122.4 + i * 0.0001, 37.7 + i * 0.0001] as [number, number],
    score: 40 + (i % 37),
    rank: i + 1,
    metrics: [{ key: "transit_score", label: "Transit", value: 50, kind: "calculated" as const }],
    provenance: {
      scoreBreakdown: { transit_score: 50 },
      calculations: [{ step: "test", detail: "legacy" }],
      datasets: [],
      assumptions: [],
      constraints: [],
      humanDecisions: [],
      limitations: [],
    },
    status: "eligible" as const,
  }));

  const store = {
    version: 1,
    projects: [
      {
        id: "proj-1",
        name: "Legacy bloat",
        objectiveText: HOUSING_OBJECTIVE,
        geographyLabel: "SF",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        activeScenarioId: "sc-1",
        resumeNote: null,
        lastOpenedAt: null,
      },
    ],
    scenarios: [
      {
        id: "sc-1",
        projectId: "proj-1",
        name: "Base",
        objective: {
          intent: "housing",
          parsedRequirements: [],
          rawText: HOUSING_OBJECTIVE,
        },
        constraints: [],
        weights: {},
        assumptions: [],
        geographicSelections: [],
        latestResultId: "res-1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    decisions: [],
    activities: [],
    confirmations: [],
    proposals: [],
    analysisJobs: [],
    analysisResults: [
      {
        id: "res-1",
        scenarioId: "sc-1",
        status: "completed",
        summary: "Legacy bloated result",
        completedAt: "2026-01-01T00:00:00.000Z",
        candidates,
        limitations: [],
        aggregateMetrics: [],
        stale: false,
        candidateCount: candidateCount,
        scoreSpread: 36,
        scoreMin: 40,
        scoreMax: 76,
      },
    ],
    reports: [],
    datasets: [],
    featuresByDataset: {},
  };

  return JSON.stringify(store);
}

const HOUSING_OBJECTIVE =
  "Find infill housing sites in San Francisco that sit within a 10-minute walk of frequent transit, stay out of FEMA flood zones, and can deliver at least 50 units without displacing existing parks or schools.";
