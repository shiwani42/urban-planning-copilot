import * as turf from "@turf/turf";
import type {
  Assumption,
  Candidate,
  Constraint,
  CriterionWeight,
  GeographicSelection,
  MetricValue,
  PlanningObjective,
} from "./types";
import { normalizeWeights } from "./objective";

export type FeatureProps = GeoJSON.GeoJsonProperties & {
  id?: string;
  zoning?: string;
  area_sqm?: number;
  density_uph?: number;
  land_use?: string;
  existing_units?: number;
  risk?: string;
  population?: number;
  name?: string;
  type?: string;
  service_freq?: number;
};

function featureId(f: GeoJSON.Feature, fallback: string): string {
  const p = f.properties as FeatureProps | null;
  return String(p?.id ?? f.id ?? fallback);
}

function centroidOf(f: GeoJSON.Feature): [number, number] {
  const c = turf.centroid(f);
  return c.geometry.coordinates as [number, number];
}

function areaSqm(f: GeoJSON.Feature): number {
  const p = f.properties as FeatureProps | null;
  if (p?.area_sqm && Number.isFinite(p.area_sqm)) return p.area_sqm;
  try {
    return turf.area(f);
  } catch {
    return 0;
  }
}

export function distanceMeters(
  a: GeoJSON.Feature,
  b: GeoJSON.Feature
): number {
  return turf.distance(turf.centroid(a), turf.centroid(b), { units: "meters" });
}

export function nearestDistance(
  feature: GeoJSON.Feature,
  others: GeoJSON.FeatureCollection
): { distance: number; nearestId?: string } {
  if (!others.features.length) return { distance: Number.POSITIVE_INFINITY };
  let best = Number.POSITIVE_INFINITY;
  let nearestId: string | undefined;
  others.features.forEach((o, i) => {
    const d = distanceMeters(feature, o);
    if (d < best) {
      best = d;
      nearestId = featureId(o, `f-${i}`);
    }
  });
  return { distance: best, nearestId };
}

export function intersectsRisk(
  feature: GeoJSON.Feature,
  flood: GeoJSON.FeatureCollection,
  riskValue = "high"
): boolean {
  return flood.features.some((zone) => {
    const p = zone.properties as FeatureProps | null;
    if (riskValue && p?.risk && p.risk !== riskValue) return false;
    try {
      return Boolean(
        turf.booleanIntersects(feature as GeoJSON.Feature, zone as GeoJSON.Feature)
      );
    } catch {
      return false;
    }
  });
}

export function applyAttributeFilter(
  features: GeoJSON.Feature[],
  constraint: Constraint
): GeoJSON.Feature[] {
  if (!constraint.attribute || !constraint.enabled) return features;
  const attr = constraint.attribute;
  const value = constraint.value;

  return features.filter((f) => {
    const raw = (f.properties as Record<string, unknown> | null)?.[attr];
    switch (constraint.operator) {
      case "eq":
        return raw === value;
      case "neq":
        return raw !== value;
      case "in":
        return Array.isArray(value) && value.map(String).includes(String(raw));
      case "not_in":
        return Array.isArray(value) && !value.map(String).includes(String(raw));
      case "gte":
        return Number(raw) >= Number(value);
      case "lte":
        return Number(raw) <= Number(value);
      default:
        return true;
    }
  });
}

export function applySpatialConstraints(
  features: GeoJSON.Feature[],
  constraints: Constraint[],
  layers: Record<string, GeoJSON.FeatureCollection>
): { remaining: GeoJSON.Feature[]; logs: string[] } {
  let remaining = [...features];
  const logs: string[] = [];

  for (const c of constraints.filter((x) => x.enabled && x.hard)) {
    if (c.operator === "in" || c.operator === "eq" || c.attribute) {
      const before = remaining.length;
      remaining = applyAttributeFilter(remaining, c);
      logs.push(`${c.label}: ${before} → ${remaining.length}`);
      continue;
    }

    if (c.operator === "within_distance" && c.datasetKind === "transit") {
      const transit = layers.transit;
      const threshold = Number(c.value ?? 800);
      if (!transit) {
        logs.push(`${c.label}: transit dataset missing`);
        continue;
      }
      const before = remaining.length;
      remaining = remaining.filter((f) => nearestDistance(f, transit).distance <= threshold);
      logs.push(`${c.label} (≤${threshold}m): ${before} → ${remaining.length}`);
      continue;
    }

    if (c.operator === "not_intersects" && c.datasetKind === "flood") {
      const flood = layers.flood;
      if (!flood) {
        logs.push(`${c.label}: flood dataset missing`);
        continue;
      }
      const before = remaining.length;
      remaining = remaining.filter((f) => !intersectsRisk(f, flood, String(c.value ?? "high")));
      logs.push(`${c.label}: ${before} → ${remaining.length}`);
      continue;
    }

    if (c.operator === "excluded_ids" && Array.isArray(c.value)) {
      const ids = new Set(c.value.map(String));
      const before = remaining.length;
      remaining = remaining.filter((f, i) => !ids.has(featureId(f, `p-${i}`)));
      logs.push(`${c.label}: ${before} → ${remaining.length}`);
    }
  }

  return { remaining, logs };
}

export function applyGeographicSelections(
  features: GeoJSON.Feature[],
  selections: GeographicSelection[]
): { remaining: GeoJSON.Feature[]; logs: string[] } {
  let remaining = [...features];
  const logs: string[] = [];

  for (const sel of selections) {
    const poly = turf.feature(sel.geometry);
    const before = remaining.length;
    if (sel.type === "exclusion") {
      remaining = remaining.filter((f) => {
        try {
          return !turf.booleanIntersects(f, poly);
        } catch {
          return true;
        }
      });
      logs.push(`Exclusion "${sel.label}": ${before} → ${remaining.length}`);
    } else if (sel.type === "inclusion" || sel.type === "focus") {
      remaining = remaining.filter((f) => {
        try {
          return turf.booleanIntersects(f, poly);
        } catch {
          return true;
        }
      });
      logs.push(`Inclusion "${sel.label}": ${before} → ${remaining.length}`);
    }
  }

  return { remaining, logs };
}

export function estimateHousingCapacity(
  feature: GeoJSON.Feature,
  assumptions: Assumption[]
): { capacity: number; method: string; inputs: Record<string, unknown> } {
  const p = feature.properties as FeatureProps | null;
  const area = areaSqm(feature);
  const developable =
    Number(assumptions.find((a) => a.key === "developable_fraction")?.value ?? 0.7);
  const defaultUph = Number(
    assumptions.find((a) => a.key === "units_per_hectare")?.value ?? 80
  );
  const uph = p?.density_uph && p.density_uph > 0 ? p.density_uph : defaultUph;
  const hectares = (area * developable) / 10_000;
  const existing = Number(p?.existing_units ?? 0);
  const capacity = Math.max(0, Math.round(hectares * uph - existing));
  return {
    capacity,
    method: "developable_area × density − existing_units",
    inputs: {
      area_sqm: area,
      developable_fraction: developable,
      density_uph: uph,
      existing_units: existing,
      hectares_developable: Number(hectares.toFixed(3)),
    },
  };
}

function scoreFromDistance(distance: number, goodMax: number): number {
  if (!Number.isFinite(distance)) return 0;
  if (distance <= 0) return 100;
  if (distance >= goodMax * 2) return 0;
  if (distance <= goodMax) return 100 - (distance / goodMax) * 40;
  return Math.max(0, 60 - ((distance - goodMax) / goodMax) * 60);
}

function floodResilienceScore(
  feature: GeoJSON.Feature,
  flood: GeoJSON.FeatureCollection | undefined
): number {
  if (!flood) return 50;
  if (intersectsRisk(feature, flood, "high")) return 0;
  if (intersectsRisk(feature, flood, "moderate")) return 40;
  return 100;
}

function populationNear(
  feature: GeoJSON.Feature,
  population: GeoJSON.FeatureCollection | undefined,
  radiusM: number
): number {
  if (!population) return 0;
  return population.features.reduce((sum, cell) => {
    const d = distanceMeters(feature, cell);
    if (d <= radiusM) {
      return sum + Number((cell.properties as FeatureProps | null)?.population ?? 0);
    }
    return sum;
  }, 0);
}

export interface AnalysisEngineInput {
  objective: PlanningObjective;
  constraints: Constraint[];
  weights: CriterionWeight[];
  assumptions: Assumption[];
  selections: GeographicSelection[];
  layers: Record<string, GeoJSON.FeatureCollection>;
  datasetIds: Record<string, string>;
  rejectedCandidateFeatureIds?: Set<string>;
}

export interface AnalysisEngineOutput {
  candidates: Candidate[];
  aggregateMetrics: MetricValue[];
  summary: string;
  limitations: string[];
  stepLogs: Array<{ step: string; detail: string; count?: number }>;
}

export function runSpatialAnalysis(input: AnalysisEngineInput): AnalysisEngineOutput {
  const stepLogs: AnalysisEngineOutput["stepLogs"] = [];
  const limitations: string[] = [];
  const parcels = input.layers.parcels?.features ?? [];
  if (!parcels.length) {
    return {
      candidates: [],
      aggregateMetrics: [],
      summary: "No candidate geography available.",
      limitations: ["Parcels dataset missing or empty"],
      stepLogs: [{ step: "load_candidates", detail: "No parcels loaded", count: 0 }],
    };
  }

  stepLogs.push({
    step: "load_candidates",
    detail: `Loaded ${parcels.length} parcel features`,
    count: parcels.length,
  });

  let { remaining, logs } = applySpatialConstraints(
    parcels,
    input.constraints,
    input.layers
  );
  logs.forEach((l) => stepLogs.push({ step: "filter", detail: l }));

  const geo = applyGeographicSelections(remaining, input.selections);
  remaining = geo.remaining;
  geo.logs.forEach((l) => stepLogs.push({ step: "geographic_exclusion", detail: l }));

  if (input.rejectedCandidateFeatureIds?.size) {
    const before = remaining.length;
    remaining = remaining.filter(
      (f, i) => !input.rejectedCandidateFeatureIds!.has(featureId(f, `p-${i}`))
    );
    stepLogs.push({
      step: "human_rejection",
      detail: `Removed previously rejected features: ${before} → ${remaining.length}`,
      count: remaining.length,
    });
  }

  if (!input.layers.transit) limitations.push("Transit dataset unavailable — proximity scores degraded");
  if (!input.layers.flood) limitations.push("Flood dataset unavailable — flood resilience uncertain");
  if (!input.layers.population)
    limitations.push("Population dataset unavailable — coverage metrics limited");

  const weights = normalizeWeights(input.weights);
  const transitThreshold =
    Number(
      input.constraints.find((c) => c.operator === "within_distance")?.value ?? 800
    ) || 800;

  const enriched = remaining.map((f, i) => {
    const id = featureId(f, `candidate-${i}`);
    const transit = input.layers.transit
      ? nearestDistance(f, input.layers.transit)
      : { distance: Number.POSITIVE_INFINITY };
    const capacityInfo = estimateHousingCapacity(f, input.assumptions);
    const floodScore = floodResilienceScore(f, input.layers.flood);
    const transitScore = scoreFromDistance(transit.distance, transitThreshold);
    const shelterRadius = Number(
      input.assumptions.find((a) => a.key === "shelter_service_radius_m")?.value ?? 1500
    );
    const schoolRadius = Number(
      input.assumptions.find((a) => a.key === "school_service_radius_m")?.value ?? 1000
    );
    const popCovered = populationNear(f, input.layers.population, shelterRadius);
    const schoolDist = input.layers.schools
      ? nearestDistance(f, input.layers.schools).distance
      : Number.POSITIVE_INFINITY;
    const schoolGapScore = Math.min(100, (schoolDist / schoolRadius) * 50);
    const transitGapScore = Math.min(100, (transit.distance / transitThreshold) * 50);

    const componentScores: Record<string, number> = {
      transit: transitScore,
      capacity: Math.min(100, (capacityInfo.capacity / 800) * 100),
      flood_resilience: floodScore,
      population_coverage: Math.min(100, (popCovered / 5000) * 100),
      accessibility: transitScore,
      accessibility_gain: schoolGapScore,
      underservice: schoolGapScore,
      gap_severity: transitGapScore,
    };

    let score = 0;
    const breakdown: Record<string, number> = {};
    for (const w of weights) {
      const part = (componentScores[w.key] ?? 50) * w.weight;
      breakdown[w.key] = Number(part.toFixed(2));
      score += part;
    }

    const metrics: MetricValue[] = [
      {
        key: "capacity",
        label: "Estimated housing capacity",
        value: capacityInfo.capacity,
        unit: "homes",
        kind: "calculated",
        method: capacityInfo.method,
        inputs: capacityInfo.inputs,
        assumptions: ["developable_fraction", "units_per_hectare"],
      },
      {
        key: "transit_distance_m",
        label: "Distance to nearest transit",
        value: Number.isFinite(transit.distance)
          ? Math.round(transit.distance)
          : -1,
        unit: "m",
        kind: "calculated",
        method: "centroid-to-centroid geodesic distance",
        inputs: { nearestTransitId: transit.nearestId, threshold_m: transitThreshold },
      },
      {
        key: "transit_score",
        label: "Transit accessibility score",
        value: Number(transitScore.toFixed(1)),
        kind: "calculated",
        method: "distance decay relative to threshold",
      },
      {
        key: "flood_resilience",
        label: "Flood resilience score",
        value: floodScore,
        kind: "calculated",
        method: "spatial intersection against flood risk polygons",
      },
      {
        key: "population_coverage",
        label: "Population within service radius",
        value: popCovered,
        unit: "people",
        kind: "calculated",
        method: "sum population cells within radius",
        inputs: { radius_m: shelterRadius },
      },
      {
        key: "school_distance_m",
        label: "Distance to nearest school",
        value: Number.isFinite(schoolDist) ? Math.round(schoolDist) : -1,
        unit: "m",
        kind: "calculated",
      },
    ];

    const labelBase =
      (f.properties as FeatureProps | null)?.name ||
      `Area ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? i : ""}`;

    const candidate: Candidate = {
      id,
      label: labelBase,
      featureIds: [id],
      geometry: f.geometry,
      centroid: centroidOf(f),
      score: Number(score.toFixed(1)),
      rank: 0,
      metrics,
      provenance: {
        scoreBreakdown: breakdown,
        calculations: [
          {
            name: "capacity",
            method: capacityInfo.method,
            inputs: capacityInfo.inputs,
            output: capacityInfo.capacity,
          },
          {
            name: "transit_distance",
            method: "geodesic nearest neighbor",
            inputs: { threshold_m: transitThreshold },
            output: Number.isFinite(transit.distance) ? Math.round(transit.distance) : -1,
          },
          {
            name: "composite_score",
            method: "weighted sum of normalized criteria",
            inputs: { weights: Object.fromEntries(weights.map((w) => [w.key, w.weight])) },
            output: Number(score.toFixed(1)),
          },
        ],
        datasets: Object.values(input.datasetIds),
        assumptions: input.assumptions.map((a) => a.key),
        constraints: input.constraints.filter((c) => c.enabled).map((c) => c.label),
        humanDecisions: input.selections.map((s) => s.label),
        limitations: [...limitations],
      },
      status: "eligible",
      recommendationNote: undefined,
    };
    return candidate;
  });

  // Intent-specific ranking adjustments / top-N
  let ranked = [...enriched].sort((a, b) => b.score - a.score);

  if (input.objective.intent === "emergency_shelter" && input.objective.targetValue) {
    ranked = ranked.slice(0, input.objective.targetValue);
  } else if (input.objective.intent === "transit_gap") {
    ranked.sort(
      (a, b) =>
        (b.metrics.find((m) => m.key === "transit_distance_m")?.value ?? 0) -
        (a.metrics.find((m) => m.key === "transit_distance_m")?.value ?? 0)
    );
  } else if (input.objective.intent === "school_accessibility") {
    ranked.sort(
      (a, b) =>
        (b.metrics.find((m) => m.key === "school_distance_m")?.value ?? 0) -
        (a.metrics.find((m) => m.key === "school_distance_m")?.value ?? 0)
    );
  }

  ranked.forEach((c, i) => {
    c.rank = i + 1;
    if (i === 0) {
      c.recommendationNote =
        "Highest-scoring eligible candidate under current weights and constraints.";
    }
  });

  stepLogs.push({
    step: "rank_candidates",
    detail: `Ranked ${ranked.length} candidates`,
    count: ranked.length,
  });

  const totalCapacity = ranked.reduce(
    (s, c) => s + (c.metrics.find((m) => m.key === "capacity")?.value ?? 0),
    0
  );
  const avgTransit =
    ranked.length === 0
      ? 0
      : ranked.reduce(
          (s, c) => s + (c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? 0),
          0
        ) / ranked.length;

  const aggregateMetrics: MetricValue[] = [
    {
      key: "eligible_count",
      label: "Eligible candidate areas",
      value: ranked.length,
      kind: "calculated",
      method: "count after constraints and exclusions",
    },
    {
      key: "total_capacity",
      label: "Estimated housing capacity",
      value: totalCapacity,
      unit: "homes",
      kind: "calculated",
      method: "sum of parcel capacity estimates",
    },
    {
      key: "avg_transit_distance",
      label: "Average transit distance",
      value: Math.round(avgTransit),
      unit: "m",
      kind: "calculated",
    },
  ];

  let summary: string;
  if (ranked.length === 0) {
    summary =
      "No feasible candidates found under the current constraints. Consider relaxing transit distance, flood exclusion, zoning filters, or geographic exclusions.";
  } else if (
    input.objective.intent === "housing_capacity" &&
    input.objective.targetValue &&
    totalCapacity < input.objective.targetValue
  ) {
    summary = `Found ${ranked.length} eligible areas totaling ~${totalCapacity} homes, below the target of ${input.objective.targetValue}.`;
  } else {
    summary = `Found ${ranked.length} eligible candidates. Top recommendation: ${ranked[0].label} (score ${ranked[0].score}).`;
  }

  return { candidates: ranked, aggregateMetrics, summary, limitations, stepLogs };
}

export function compareScenarioMetrics(
  results: Array<{ scenarioId: string; name: string; result: AnalysisEngineOutput | null }>
): Array<Record<string, string | number>> {
  return results.map((r) => {
    const ag = r.result?.aggregateMetrics ?? [];
    const get = (k: string) => ag.find((m) => m.key === k)?.value ?? 0;
    return {
      scenarioId: r.scenarioId,
      name: r.name,
      eligible_count: get("eligible_count"),
      total_capacity: get("total_capacity"),
      avg_transit_distance: get("avg_transit_distance"),
      top_score: r.result?.candidates[0]?.score ?? 0,
    };
  });
}
