"use client";

import type { DatasetMeta } from "@/lib/domain/types";
import { ProvenanceChip } from "@/components/workspace-hooks";
import {
  datasetFreshnessFlags,
  parcelReferenceFeatureCount,
} from "@/lib/dataset-freshness";

export function DatasetProvenanceChips({
  dataset,
  datasets,
}: {
  dataset: DatasetMeta;
  datasets?: DatasetMeta[];
}) {
  const referenceFeatureCount = datasets ? parcelReferenceFeatureCount(datasets) : undefined;
  const freshness = datasetFreshnessFlags(dataset, { referenceFeatureCount });

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {!dataset.synthetic && <ProvenanceChip kind="source_data" />}
      {dataset.synthetic && (
        <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 border border-secondary text-secondary">
          Synthetic
        </span>
      )}
      {dataset.stale && (
        <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 border border-error text-error">
          Catalog outdated
        </span>
      )}
      {freshness.vintageStale && !dataset.stale && (
        <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 border border-secondary text-secondary">
          Vintage stale
        </span>
      )}
      {freshness.sparseCoverage && (
        <span className="font-mono text-[10px] uppercase px-1.5 py-0.5 border border-secondary text-secondary">
          Partial coverage
        </span>
      )}
    </span>
  );
}
