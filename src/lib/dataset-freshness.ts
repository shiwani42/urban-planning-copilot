import type { DatasetMeta } from "@/lib/domain/types";

export const DEFAULT_STALE_VINTAGE_YEARS = 2;
export const SPARSE_FEATURE_THRESHOLD = 50;

/** Parse catalog data vintage strings (ISO timestamps or YYYY-MM-DD labels). */
export function parseDataVintageDate(dataVintage?: string): Date | null {
  if (!dataVintage?.trim()) return null;
  const direct = new Date(dataVintage);
  if (!Number.isNaN(direct.getTime())) return direct;
  const prefix = dataVintage.match(/(\d{4}-\d{2}-\d{2})/);
  if (!prefix) return null;
  const parsed = new Date(prefix[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function vintageAgeYears(dataVintage?: string, asOf = new Date()): number | null {
  const vintage = parseDataVintageDate(dataVintage);
  if (!vintage) return null;
  return (asOf.getTime() - vintage.getTime()) / (365.25 * 24 * 60 * 60 * 1000);
}

export function isVintageStale(
  dataVintage?: string,
  thresholdYears = DEFAULT_STALE_VINTAGE_YEARS,
  asOf = new Date()
): boolean {
  const age = vintageAgeYears(dataVintage, asOf);
  if (age == null) return false;
  return age >= thresholdYears;
}

export function parcelReferenceFeatureCount(datasets: DatasetMeta[]): number | undefined {
  const parcels = datasets.find((d) => d.kind === "parcels");
  return parcels?.featureCount;
}

export function isSparseDatasetCoverage(
  dataset: DatasetMeta,
  referenceFeatureCount?: number
): boolean {
  if (dataset.incompleteCoverage) return true;
  if (dataset.featureCount <= 1) return true;
  if (referenceFeatureCount != null && referenceFeatureCount >= 100) {
    const ratio = dataset.featureCount / referenceFeatureCount;
    if (ratio < 0.02) return true;
  }
  if (dataset.kind === "transit") {
    return dataset.featureCount < 10;
  }
  return dataset.featureCount < SPARSE_FEATURE_THRESHOLD;
}

export type DatasetFreshnessFlags = {
  vintageStale: boolean;
  sparseCoverage: boolean;
  vintageYearsOld: number | null;
  cautionSummary: string | null;
};

export function datasetFreshnessFlags(
  dataset: DatasetMeta,
  options?: { referenceFeatureCount?: number; asOf?: Date }
): DatasetFreshnessFlags {
  const asOf = options?.asOf ?? new Date();
  const vintageStale = isVintageStale(dataset.dataVintage, DEFAULT_STALE_VINTAGE_YEARS, asOf);
  const sparseCoverage = isSparseDatasetCoverage(dataset, options?.referenceFeatureCount);
  const vintageYearsOld = vintageAgeYears(dataset.dataVintage, asOf);

  const cautions: string[] = [];
  if (vintageStale && dataset.dataVintage) {
    const rounded =
      vintageYearsOld != null ? Math.floor(vintageYearsOld) : DEFAULT_STALE_VINTAGE_YEARS;
    cautions.push(`Data vintage is ${rounded}+ years old (${dataset.dataVintage})`);
  }
  if (sparseCoverage) {
    if (dataset.incompleteCoverage || dataset.featureCount <= 1) {
      cautions.push(
        `Sparse clip for this study area (${dataset.featureCount.toLocaleString()} feature${dataset.featureCount === 1 ? "" : "s"})`
      );
    } else {
      cautions.push(
        `Limited coverage (${dataset.featureCount.toLocaleString()} features for this AOI)`
      );
    }
  }

  return {
    vintageStale,
    sparseCoverage,
    vintageYearsOld,
    cautionSummary: cautions.length ? cautions.join(" · ") : null,
  };
}
