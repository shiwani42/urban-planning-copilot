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
      const excluded = before - remaining.length;
      if (excluded === 0) {
        logs.push(`${c.label}: ${before} → ${remaining.length} (no high-risk flood overlap in study area)`);
      } else {
        logs.push(`${c.label}: ${before} → ${remaining.length}`);
      }
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
  if (distance <= 0) return 99;
  if (distance >= goodMax * 2) return 1;
  if (distance <= goodMax) return 99 - (distance / goodMax) * 48;
  return Math.max(1, 51 - ((distance - goodMax) / goodMax) * 50);
}

/** Spread values across 1–99 to avoid score ceilings and unbreakable ties. */
function percentileScore(value: number, allValues: number[], higherIsBetter: boolean): number {
  const finite = allValues.filter((v) => Number.isFinite(v));
  if (!finite.length || !Number.isFinite(value)) return 0;
  const min = Math.min(...finite);
  const max = Math.max(...finite);
  if (max === min) return 50;
  const pct = (value - min) / (max - min);
  const normalized = higherIsBetter ? pct : 1 - pct;
  return Number((normalized * 98 + 1).toFixed(1));
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
  /** Dataset / analysis limitations merged into result and candidate provenance */
  externalLimitations?: string[];
  /** Explore scratch profile — adjusts scoring, ranking, and aggregate KPIs */
  exploreProfile?:
    | "transit_gap"
    | "school_gap"
    | "flood_exposure"
    | "housing_siting"
    | "emergency_shelter"
    | "unsupported";
}

function compositeScore(
  componentScores: Record<string, number>,
  weights: CriterionWeight[]
): { score: number; breakdown: Record<string, number> } {
  const active = weights.filter((w) => componentScores[w.key] != null);
  const weightSum = active.reduce((s, w) => s + w.weight, 0);
  if (!active.length || weightSum <= 0) {
    return { score: 0, breakdown: {} };
  }
  const breakdown: Record<string, number> = {};
  let score = 0;
  for (const w of active) {
    const normalizedWeight = w.weight / weightSum;
    const part = componentScores[w.key]! * normalizedWeight;
    breakdown[w.key] = Number(part.toFixed(2));
    score += part;
  }
  return { score: Number(score.toFixed(1)), breakdown };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
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
  if (input.externalLimitations?.length) {
    for (const note of input.externalLimitations) {
      if (!limitations.includes(note)) limitations.push(note);
    }
  }

  const floodConstraint = input.constraints.find(
    (c) => c.enabled && c.datasetKind === "flood" && c.operator === "not_intersects"
  );
  if (floodConstraint) {
    const floodLog = stepLogs.find((l) => l.detail.toLowerCase().includes("flood"));
    if (floodLog?.detail.includes("no high-risk flood overlap")) {
      limitations.push(
        "Flood exclusion constraint did not remove any parcels — high-risk overlap may be absent or incompletely mapped"
      );
    }
  }

  const weights = normalizeWeights(input.weights);
  const capacityScoreDenominator =
    input.objective.intent === "housing_capacity" && input.objective.targetValue
      ? input.objective.targetValue
      : 800;
  const transitThreshold =
    Number(
      input.constraints.find((c) => c.operator === "within_distance")?.value ?? 800
    ) || 800;

  const shelterRadius = Number(
    input.assumptions.find((a) => a.key === "shelter_service_radius_m")?.value ?? 1500
  );
  const schoolRadius = Number(
    input.assumptions.find((a) => a.key === "school_service_radius_m")?.value ?? 1000
  );

  type RawCandidate = {
    feature: GeoJSON.Feature;
    id: string;
    transitDist: number;
    schoolDist: number;
    popCovered: number;
    capacityInfo: ReturnType<typeof estimateHousingCapacity>;
    floodScore: number;
    floodExposure: number;
    labelBase: string;
  };

  const rawCandidates: RawCandidate[] = remaining.map((f, i) => {
    const id = featureId(f, `candidate-${i}`);
    const transit = input.layers.transit
      ? nearestDistance(f, input.layers.transit)
      : { distance: Number.POSITIVE_INFINITY };
    const schoolDist = input.layers.schools
      ? nearestDistance(f, input.layers.schools).distance
      : Number.POSITIVE_INFINITY;
    const popCovered = populationNear(
      f,
      input.layers.population,
      input.exploreProfile === "school_gap" ? schoolRadius : shelterRadius
    );
    const floodScore = floodResilienceScore(f, input.layers.flood);
    const intersectsHigh = input.layers.flood
      ? intersectsRisk(f, input.layers.flood, "high")
      : false;
    const intersectsModerate = input.layers.flood
      ? intersectsRisk(f, input.layers.flood, "moderate")
      : false;
    const floodExposure = intersectsHigh ? 100 : intersectsModerate ? 65 : 15;
    const labelBase =
      (f.properties as FeatureProps | null)?.name ||
      `Area ${String.fromCharCode(65 + (i % 26))}${i >= 26 ? `-${i}` : ""}`;
    return {
      feature: f,
      id,
      transitDist: transit.distance,
      schoolDist,
      popCovered,
      capacityInfo: estimateHousingCapacity(f, input.assumptions),
      floodScore,
      floodExposure,
      labelBase,
    };
  });

  const transitDists = rawCandidates.map((r) => r.transitDist);
  const schoolDists = rawCandidates.map((r) => r.schoolDist);
  const popValues = rawCandidates.map((r) => r.popCovered);
  const capacityValues = rawCandidates.map((r) => r.capacityInfo.capacity);
  const floodExposureValues = rawCandidates.map((r) => r.floodExposure);

  const enriched = rawCandidates.map((raw, i) => {
    const f = raw.feature;
    const id = raw.id;
    const transitScore = scoreFromDistance(raw.transitDist, transitThreshold);
    const transitGapScore = percentileScore(raw.transitDist, transitDists, true);
    const schoolGapScore = percentileScore(raw.schoolDist, schoolDists, true);
    const popCoverageScore = percentileScore(raw.popCovered, popValues, true);
    const capacityScore = percentileScore(
      raw.capacityInfo.capacity,
      capacityValues,
      true
    );
    const floodExposureScore = percentileScore(
      raw.floodExposure,
      floodExposureValues,
      true
    );

    const componentScores: Record<string, number> = {
      transit: transitScore,
      capacity: capacityScore,
      flood_resilience: raw.floodScore,
      flood_exposure: floodExposureScore,
      population_coverage: popCoverageScore,
      accessibility: transitScore,
      accessibility_gain: schoolGapScore,
      underservice: schoolGapScore,
      gap_severity: transitGapScore,
    };

    let profileScore: number | undefined;
    if (input.exploreProfile === "transit_gap") {
      profileScore = transitGapScore;
    } else if (input.exploreProfile === "school_gap") {
      profileScore = schoolGapScore;
    } else if (input.exploreProfile === "flood_exposure") {
      profileScore = floodExposureScore;
    }

    const { score: composite, breakdown } = compositeScore(componentScores, weights);
    const score = profileScore ?? composite;

    const metrics: MetricValue[] = [
      {
        key: "capacity",
        label: "Estimated housing capacity",
        value: raw.capacityInfo.capacity,
        unit: "homes",
        kind: "calculated",
        method: raw.capacityInfo.method,
        inputs: raw.capacityInfo.inputs,
        assumptions: ["developable_fraction", "units_per_hectare"],
      },
      {
        key: "transit_distance_m",
        label: "Distance to nearest transit",
        value: Number.isFinite(raw.transitDist) ? Math.round(raw.transitDist) : -1,
        unit: "m",
        kind: "calculated",
        method: "centroid-to-centroid geodesic distance",
        inputs: { threshold_m: transitThreshold },
      },
      {
        key: "transit_gap_score",
        label: "Transit gap score",
        value: transitGapScore,
        kind: "calculated",
        method: "percentile rank of transit distance across study area",
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
        value: raw.floodScore,
        kind: "calculated",
        method: "spatial intersection against flood risk polygons",
      },
      {
        key: "flood_exposure_score",
        label: "Flood exposure score",
        value: floodExposureScore,
        kind: "calculated",
        method: "percentile rank of flood zone intersection severity",
      },
      {
        key: "population_coverage",
        label: "Population within service radius",
        value: raw.popCovered,
        unit: "people",
        kind: "calculated",
        method: "sum population cells within radius",
        inputs: {
          radius_m:
            input.exploreProfile === "school_gap" ? schoolRadius : shelterRadius,
        },
      },
      {
        key: "school_distance_m",
        label: "Distance to nearest school",
        value: Number.isFinite(raw.schoolDist) ? Math.round(raw.schoolDist) : -1,
        unit: "m",
        kind: "calculated",
      },
      {
        key: "school_gap_score",
        label: "School access gap score",
        value: schoolGapScore,
        kind: "calculated",
        method: "percentile rank of school distance across study area",
      },
    ];

    if (input.objective.intent === "housing_capacity" && input.objective.targetValue) {
      const target = input.objective.targetValue;
      const cap = raw.capacityInfo.capacity;
      const meets = cap >= target;
      metrics.push({
        key: "housing_target_gap",
        label: meets ? "Meets housing target" : "Shortfall vs housing target",
        value: Math.abs(cap - target),
        unit: "homes",
        kind: "calculated",
        method: meets
          ? `Parcel capacity (${cap}) meets per-site target (${target})`
          : `Parcel capacity (${cap}) is ${target - cap} homes below per-site target (${target})`,
        inputs: { capacity: cap, target_homes: target, meets_alone: meets },
      });
    }

    const label = raw.labelBase;

    const candidate: Candidate = {
      id,
      label,
      featureIds: [id],
      geometry: f.geometry,
      centroid: centroidOf(f),
      score: Number(score.toFixed(1)),
      rank: 0,
      metrics,
      provenance: {
        scoreBreakdown: profileScore != null ? { profile: profileScore, ...breakdown } : breakdown,
        calculations: [
          {
            name: "capacity",
            method: raw.capacityInfo.method,
            inputs: raw.capacityInfo.inputs,
            output: raw.capacityInfo.capacity,
          },
          {
            name: "transit_distance",
            method: "geodesic nearest neighbor",
            inputs: { threshold_m: transitThreshold },
            output: Number.isFinite(raw.transitDist) ? Math.round(raw.transitDist) : -1,
          },
          {
            name: "composite_score",
            method: profileScore != null
              ? "explore profile score (percentile-calibrated)"
              : "weighted sum of normalized criteria",
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

  const sortMetricKey =
    input.exploreProfile === "school_gap"
      ? "school_distance_m"
      : input.exploreProfile === "transit_gap"
        ? "transit_distance_m"
        : input.exploreProfile === "flood_exposure"
          ? "flood_exposure_score"
          : null;

  let ranked = [...enriched].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (sortMetricKey) {
      const mA = a.metrics.find((m) => m.key === sortMetricKey)?.value ?? 0;
      const mB = b.metrics.find((m) => m.key === sortMetricKey)?.value ?? 0;
      if (mB !== mA) return mB - mA;
    }
    const capA = a.metrics.find((m) => m.key === "capacity")?.value ?? 0;
    const capB = b.metrics.find((m) => m.key === "capacity")?.value ?? 0;
    if (capB !== capA) return capB - capA;
    return a.id.localeCompare(b.id);
  });

  if (input.objective.intent === "emergency_shelter" && input.objective.targetValue) {
    ranked = ranked.slice(0, input.objective.targetValue);
  }

  ranked.forEach((c, i) => {
    c.rank = i + 1;
    c.provenance.limitations = [...limitations];
    if (i === 0) {
      c.recommendationNote =
        input.exploreProfile === "transit_gap"
          ? "Largest transit accessibility gap in the study area."
          : input.exploreProfile === "school_gap"
            ? "Largest school access gap in the study area."
            : input.exploreProfile === "flood_exposure"
              ? "Highest flood exposure among analyzed areas."
              : "Highest-scoring eligible candidate under current weights and constraints.";
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
  const transitDistances = ranked
    .map((c) => c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? -1)
    .filter((d) => d >= 0);
  const avgTransit =
    transitDistances.length === 0
      ? 0
      : transitDistances.reduce((s, d) => s + d, 0) / transitDistances.length;
  const medianTransit = median(transitDistances);

  const schoolDistances = ranked
    .map((c) => c.metrics.find((m) => m.key === "school_distance_m")?.value ?? -1)
    .filter((d) => d >= 0);
  const avgSchool =
    schoolDistances.length === 0
      ? 0
      : schoolDistances.reduce((s, d) => s + d, 0) / schoolDistances.length;
  const medianSchool = median(schoolDistances);

  const isGapProfile =
    input.exploreProfile === "transit_gap" ||
    input.exploreProfile === "school_gap" ||
    input.exploreProfile === "flood_exposure";

  const gapDistances =
    input.exploreProfile === "school_gap" ? schoolDistances : transitDistances;
  const avgGap =
    gapDistances.length === 0
      ? 0
      : gapDistances.reduce((s, d) => s + d, 0) / gapDistances.length;
  const medianGap =
    input.exploreProfile === "school_gap" ? medianSchool : medianTransit;

  const aggregateMetrics: MetricValue[] = isGapProfile
    ? [
        {
          key: "gap_area_count",
          label:
            input.exploreProfile === "school_gap"
              ? "Areas analyzed for school access"
              : input.exploreProfile === "flood_exposure"
                ? "Areas analyzed for flood exposure"
                : "Areas with transit gaps",
          value: ranked.length,
          kind: "calculated",
          method: "parcel count in gap investigation",
        },
        {
          key: "population_in_gap_areas",
          label: "Population in analyzed areas",
          value: ranked.reduce(
            (s, c) =>
              s + (c.metrics.find((m) => m.key === "population_coverage")?.value ?? 0),
            0
          ),
          unit: "people",
          kind: "calculated",
          method: "sum of population within service radius per area",
        },
        {
          key: "avg_gap_distance_m",
          label:
            input.exploreProfile === "school_gap"
              ? "Average school distance"
              : "Average transit distance",
          value: Math.round(avgGap),
          unit: "m",
          kind: "calculated",
          method: "mean distance to nearest service",
        },
        {
          key: "median_gap_distance_m",
          label:
            input.exploreProfile === "school_gap"
              ? "Median school distance"
              : "Median transit distance",
          value: Math.round(medianGap),
          unit: "m",
          kind: "calculated",
          method: "median distance to nearest service",
        },
      ]
    : [
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
          method: "mean of eligible candidate transit distances",
        },
        {
          key: "median_transit_distance",
          label: "Median transit distance",
          value: medianTransit,
          unit: "m",
          kind: "calculated",
          method: "median of eligible candidate transit distances",
        },
      ];

  if (
    input.objective.intent === "housing_capacity" &&
    input.objective.targetValue
  ) {
    const target = input.objective.targetValue;
    const meetsAlone = ranked.filter(
      (c) => (c.metrics.find((m) => m.key === "capacity")?.value ?? 0) >= target
    ).length;
    aggregateMetrics.push({
      key: "meets_target_count",
      label: "Candidates meeting housing target alone",
      value: meetsAlone,
      kind: "calculated",
      method: `count of parcels with capacity ≥ ${target} homes`,
      inputs: { target_homes: target },
    });
  }

  if (
    input.objective.intent === "housing_capacity" &&
    input.objective.targetValue &&
    input.objective.targetUnit === "homes"
  ) {
    const target = input.objective.targetValue;
    const gap = totalCapacity - target;
    aggregateMetrics.push({
      key: "housing_target_gap",
      label: gap >= 0 ? "Meets housing target" : "Shortfall vs housing target",
      value: Math.abs(gap),
      unit: "homes",
      kind: "calculated",
      method:
        gap >= 0
          ? `Eligible capacity (${totalCapacity}) meets or exceeds target (${target})`
          : `Eligible capacity (${totalCapacity}) is below target (${target})`,
      inputs: { target_homes: target, eligible_capacity: totalCapacity, gap },
    });
  }

  let summary: string;
  if (ranked.length === 0) {
    summary = isGapProfile
      ? "No areas matched this gap investigation."
      : "No feasible candidates found under the current constraints. Consider relaxing transit distance, flood exclusion, zoning filters, or geographic exclusions.";
  } else if (
    input.objective.intent === "housing_capacity" &&
    input.objective.targetValue &&
    totalCapacity < input.objective.targetValue
  ) {
    summary = `Found ${ranked.length} eligible areas totaling ~${totalCapacity} homes, below the target of ${input.objective.targetValue}.`;
  } else if (
    input.objective.intent === "housing_capacity" &&
    input.objective.targetValue &&
    totalCapacity >= input.objective.targetValue
  ) {
    summary = `Found ${ranked.length} eligible areas totaling ~${totalCapacity} homes, meeting the target of ${input.objective.targetValue}. Top recommendation: ${ranked[0].label} (score ${ranked[0].score}).`;
  } else {
    summary = `Found ${ranked.length} eligible candidates. Top recommendation: ${ranked[0].label} (score ${ranked[0].score}).`;
  }

  return { candidates: ranked, aggregateMetrics, summary, limitations, stepLogs };
}

export interface ScenarioComparisonInput {
  scenarioId: string;
  name: string;
  weights?: CriterionWeight[];
  housingTarget?: number;
  result: AnalysisEngineOutput | null;
}

export function compareScenarioMetrics(
  results: ScenarioComparisonInput[]
): Array<Record<string, string | number>> {
  return results.map((r) => {
    const ag = r.result?.aggregateMetrics ?? [];
    const get = (k: string) => ag.find((m) => m.key === k)?.value ?? 0;
    const candidates = r.result?.candidates ?? [];
    const top = candidates[0];
    const topCap = top?.metrics.find((m) => m.key === "capacity")?.value ?? 0;
    const meetsAlone =
      r.housingTarget != null
        ? candidates.filter(
            (c) =>
              (c.metrics.find((m) => m.key === "capacity")?.value ?? 0) >= r.housingTarget!
          ).length
        : get("meets_target_count");
    const weightProfile = (r.weights ?? [])
      .map((w) => `${w.label.replace(/ accessibility/i, "")} ${Math.round(w.weight * 100)}%`)
      .join(" · ");

    return {
      scenarioId: r.scenarioId,
      name: r.name,
      eligible_count: get("eligible_count"),
      total_capacity: get("total_capacity"),
      avg_transit_distance: get("avg_transit_distance"),
      median_transit_distance: get("median_transit_distance"),
      meets_target_count: meetsAlone,
      top_candidate: top?.label ?? "—",
      top_candidate_capacity: topCap,
      top_rank_score: top?.score ?? 0,
      top_3: candidates
        .slice(0, 3)
        .map((c) => c.label)
        .join(", ") || "—",
      weight_profile: weightProfile || "—",
    };
  });
}

export function buildComparisonInsights(
  results: ScenarioComparisonInput[]
): Array<{ heading: string; body: string }> {
  const insights: Array<{ heading: string; body: string }> = [];
  const withResults = results.filter((r) => r.result && r.result.candidates.length > 0);
  if (withResults.length < 2) {
    insights.push({
      heading: "Insufficient data",
      body: "Run analysis on at least two scenarios before comparing trade-offs.",
    });
    return insights;
  }

  if (results.length === 2) {
    const [a, b] = results;
    const candA = a.result!.candidates;
    const candB = b.result!.candidates;
    const topChanged = candA[0]?.id !== candB[0]?.id;
    insights.push({
      heading: "Top recommendation",
      body: topChanged
        ? `Changed from ${candA[0]?.label ?? "—"} (${a.name}) to ${candB[0]?.label ?? "—"} (${b.name}).`
        : `Unchanged: ${candA[0]?.label ?? "—"} leads both scenarios.`,
    });

    const rankShifts: string[] = [];
    const labelsA = candA.slice(0, 5).map((c) => c.label);
    const labelsB = candB.slice(0, 5).map((c) => c.label);
    for (let i = 0; i < 5; i++) {
      if (labelsA[i] !== labelsB[i]) {
        rankShifts.push(
          `#${i + 1}: ${labelsA[i] ?? "—"} → ${labelsB[i] ?? "—"}`
        );
      }
    }
    insights.push({
      heading: "Top-5 ranking shifts",
      body: rankShifts.length
        ? rankShifts.join("; ")
        : "Top five candidate order is identical.",
    });

    const scoreDelta =
      (candB[0]?.score ?? 0) - (candA[0]?.score ?? 0);
    insights.push({
      heading: "Rank score note",
      body: `Absolute rank scores (${candA[0]?.score ?? "—"} vs ${candB[0]?.score ?? "—"}, Δ ${scoreDelta >= 0 ? "+" : ""}${scoreDelta.toFixed(1)}) reflect each scenario's weights — compare ranking and capacity trade-offs, not raw score magnitude across scenarios.`,
    });

    if (a.housingTarget) {
      const meetsA = candA.filter(
        (c) => (c.metrics.find((m) => m.key === "capacity")?.value ?? 0) >= a.housingTarget!
      ).length;
      const meetsB = candB.filter(
        (c) => (c.metrics.find((m) => m.key === "capacity")?.value ?? 0) >= b.housingTarget!
      ).length;
      insights.push({
        heading: "Housing target coverage",
        body: `Parcels that alone meet ${a.housingTarget.toLocaleString()} homes: ${meetsA} (${a.name}) vs ${meetsB} (${b.name}).`,
      });
    }
  }

  return insights;
}
