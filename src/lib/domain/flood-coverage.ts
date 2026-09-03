import { candidateMetricValue } from "./analysis-display";
import { candidateLabelFromFeature } from "./candidate-label";
import { intersectsRisk } from "./spatial";
import type { AnalysisResult, Candidate, DatasetMeta } from "./types";

export type FloodCoverageDetail = {
  showWarning: boolean;
  summary: string;
  incompleteReason: string;
  excludedCount: number;
  beforeCount: number;
  afterCount: number;
  exclusionReasons: string[];
  excludedParcelSamples: string[];
  floodDatasetId?: string;
  hadNoOverlap: boolean;
};

export function parseFloodFunnel(stepDetail: string): { before: number; after: number } | null {
  const m = stepDetail.match(/(\d+)\s*→\s*(\d+)/);
  if (!m) return null;
  return { before: Number(m[1]), after: Number(m[2]) };
}

export function listFloodExcludedParcelLabels(input: {
  parcels: GeoJSON.Feature[];
  flood?: GeoJSON.FeatureCollection;
  candidateFeatureIds: Set<string>;
  riskValue?: string;
  limit?: number;
}): string[] {
  const { parcels, flood, candidateFeatureIds, riskValue = "high", limit = 12 } = input;
  if (!flood?.features.length) return [];

  const labels: string[] = [];
  for (const f of parcels) {
    const id = String(f.properties?.id ?? f.id ?? "");
    if (!id || candidateFeatureIds.has(id)) continue;
    if (!intersectsRisk(f, flood, riskValue)) continue;
    labels.push(candidateLabelFromFeature(f, id));
    if (labels.length >= limit) break;
  }
  return labels;
}

export function buildFloodCoverageDetail(input: {
  datasets: DatasetMeta[];
  result?: AnalysisResult;
  parcels?: GeoJSON.Feature[];
  floodLayer?: GeoJSON.FeatureCollection;
}): FloodCoverageDetail | null {
  const flood = input.datasets.find((d) => d.kind === "flood");
  if (!flood || !input.result) return null;

  const floodLog = input.result.stepLogs?.find((s) => /flood/i.test(s.detail));
  if (!floodLog) return null;

  const funnel = parseFloodFunnel(floodLog.detail);
  const beforeCount = funnel?.before ?? 0;
  const afterCount = funnel?.after ?? 0;
  const excludedCount = funnel ? beforeCount - afterCount : 0;
  const hadNoOverlap = floodLog.detail.includes("no high-risk flood overlap");
  const incomplete = Boolean(flood.incompleteCoverage) || flood.featureCount <= 1;

  if (!incomplete && excludedCount < 10) return null;

  const incompleteReason = incomplete
    ? `SFPUC July 2022 100-year storm flood is a partial clip (${flood.featureCount} zone feature${flood.featureCount === 1 ? "" : "s"} in catalog) — not FEMA NFHL. Parcels outside this visible layer are coverage gaps, not proof of safety.`
    : "SFPUC storm-flood polygons cover the full study boundary for this dataset.";

  const exclusionReasons: string[] = [];
  if (excludedCount > 0) {
    exclusionReasons.push(
      `${excludedCount} parcel${excludedCount === 1 ? "" : "s"} intersect high-risk flood zones and were removed by the hard flood constraint (${beforeCount} → ${afterCount} eligible).`
    );
  }
  if (hadNoOverlap) {
    exclusionReasons.push("No high-risk flood overlap was detected in the study area for this run.");
  }
  for (const lim of input.result.limitations ?? []) {
    if (/flood/i.test(lim) && !exclusionReasons.includes(lim)) {
      exclusionReasons.push(lim);
    }
  }

  const candidateFeatureIds = new Set(
    input.result.candidates.flatMap((c) => c.featureIds)
  );
  const excludedParcelSamples =
    input.parcels && input.floodLayer
      ? listFloodExcludedParcelLabels({
          parcels: input.parcels,
          flood: input.floodLayer,
          candidateFeatureIds,
        })
      : [];

  const summary = incomplete
    ? `SFPUC storm-flood clip has incomplete coverage. ${excludedCount} parcel${excludedCount === 1 ? "" : "s"} excluded — not FEMA; verify site-specific flood risk before decisions.`
    : `${excludedCount} parcel${excludedCount === 1 ? "" : "s"} excluded by the visible SFPUC flood layer — review before decisions.`;

  return {
    showWarning: true,
    summary,
    incompleteReason,
    excludedCount,
    beforeCount,
    afterCount,
    exclusionReasons,
    excludedParcelSamples,
    floodDatasetId: flood.id,
    hadNoOverlap,
  };
}

/** Caveat when a high flood-resilience score may reflect missing coverage, not low risk. */
export function candidateFloodIncompleteCaveat(
  floodDataset: DatasetMeta | undefined,
  candidate: Candidate
): string | null {
  if (!floodDataset?.incompleteCoverage) return null;
  const resilience = candidateMetricValue(candidate, "flood_resilience");
  if (resilience == null || resilience < 70) return null;
  return "High flood resilience here means no overlap with the visible SFPUC 100-year storm clip — not FEMA. Coverage is incomplete; verify site-specific flood risk before decisions.";
}

function extendBbox(
  acc: [number, number, number, number] | null,
  coords: number[]
): [number, number, number, number] {
  const lng = coords[0];
  const lat = coords[1];
  if (acc == null) return [lng, lat, lng, lat];
  return [
    Math.min(acc[0], lng),
    Math.min(acc[1], lat),
    Math.max(acc[2], lng),
    Math.max(acc[3], lat),
  ];
}

function walkCoords(coords: unknown, acc: [number, number, number, number] | null): [number, number, number, number] | null {
  if (!Array.isArray(coords) || coords.length === 0) return acc;
  if (typeof coords[0] === "number") {
    return extendBbox(acc, coords as number[]);
  }
  let next = acc;
  for (const child of coords) {
    next = walkCoords(child, next);
  }
  return next;
}

function geometryCoordinates(g?: GeoJSON.Geometry | null): unknown {
  if (!g) return undefined;
  if (g.type === "GeometryCollection") {
    return g.geometries.map((child) => geometryCoordinates(child));
  }
  return g.coordinates;
}

export function floodLayerBbox(
  flood?: GeoJSON.FeatureCollection
): [number, number, number, number] | null {
  if (!flood?.features.length) return null;
  let acc: [number, number, number, number] | null = null;
  for (const f of flood.features) {
    acc = walkCoords(geometryCoordinates(f.geometry), acc);
  }
  return acc;
}

function centroidOfFeature(f: GeoJSON.Feature): [number, number] | null {
  const g = f.geometry;
  if (!g) return null;
  if (g.type === "Point") return g.coordinates as [number, number];
  const bbox = walkCoords(geometryCoordinates(g), null);
  if (!bbox) return null;
  return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

/** Parcel ids whose centroid sits outside the flood layer extent — coverage gap, not "safe". */
export function featureIdsOutsideFloodCoverage(
  parcels: GeoJSON.Feature[],
  flood?: GeoJSON.FeatureCollection
): Set<string> {
  const ids = new Set<string>();
  const bbox = floodLayerBbox(flood);
  for (const f of parcels) {
    const id = String(f.properties?.id ?? f.id ?? "");
    if (!id) continue;
    if (!bbox) {
      ids.add(id);
      continue;
    }
    const c = centroidOfFeature(f);
    if (!c) continue;
    if (c[0] < bbox[0] || c[1] < bbox[1] || c[0] > bbox[2] || c[1] > bbox[3]) {
      ids.add(id);
    }
  }
  return ids;
}
