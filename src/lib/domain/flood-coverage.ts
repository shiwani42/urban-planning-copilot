import { candidateLabelFromFeature } from "./candidate-label";
import { intersectsRisk } from "./spatial";
import type { AnalysisResult, DatasetMeta } from "./types";

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
    ? `Flood hazard data is partial for this study area (${flood.featureCount} zone feature${flood.featureCount === 1 ? "" : "s"} in catalog). Parcel-level FEMA or local studies may show risks not captured in this layer.`
    : "Flood hazard polygons cover the full study boundary for this dataset.";

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
    ? `Flood layer has incomplete coverage. ${excludedCount} parcel${excludedCount === 1 ? "" : "s"} excluded — verify site-specific flood risk before decisions.`
    : `${excludedCount} parcel${excludedCount === 1 ? "" : "s"} excluded by flood constraint — review before decisions.`;

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
