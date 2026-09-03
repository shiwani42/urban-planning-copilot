"use client";

import type { DatasetMeta } from "@/lib/domain/types";
import { DatasetProvenanceChips } from "@/components/DatasetProvenanceChips";
import { formatLocaleDateTime } from "@/lib/format";
import { datasetFreshnessFlags, parcelReferenceFeatureCount } from "@/lib/dataset-freshness";

export function DatasetInspectPanel({
  dataset,
  enabledForScenario,
  datasets,
  onClose,
  onShowOnMap,
}: {
  dataset: DatasetMeta;
  enabledForScenario: boolean;
  datasets?: DatasetMeta[];
  onClose: () => void;
  onShowOnMap: () => void;
}) {
  const referenceFeatureCount = datasets ? parcelReferenceFeatureCount(datasets) : undefined;
  const freshness = datasetFreshnessFlags(dataset, { referenceFeatureCount });
  const completeness =
    dataset.incompleteCoverage || dataset.featureCount <= 1
      ? "Incomplete"
      : freshness.sparseCoverage
        ? "Partial"
        : "Good";
  const fitness =
    dataset.synthetic || dataset.stale || freshness.vintageStale || freshness.sparseCoverage
      ? "Use with caution"
      : !dataset.enabled
        ? "Disabled in catalog"
        : enabledForScenario
          ? "Active in this scenario"
          : "Available but not enabled";

  return (
    <div className="fixed inset-y-0 right-0 w-full max-w-md z-[2000] bg-surface border-l border-outline-variant shadow-xl flex flex-col">
      <div className="p-4 border-b border-outline-variant flex items-start justify-between gap-3">
        <div>
          <h2 className="text-headline-md">{dataset.name}</h2>
          <p className="text-caption text-on-surface-variant mt-1">{dataset.kind}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 hover:bg-surface-variant rounded"
          aria-label="Close inspect panel"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-5 text-body-sm">
        <section>
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
            Fitness for analysis
          </h3>
          <p>{fitness}</p>
          <div className="mt-2">
            <DatasetProvenanceChips dataset={dataset} datasets={datasets} />
          </div>
          {freshness.cautionSummary && (
            <p className="mt-2 text-caption text-secondary">{freshness.cautionSummary}</p>
          )}
        </section>
        <section>
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
            Completeness
          </h3>
          <dl className="grid grid-cols-2 gap-2">
            <div>
              <dt className="text-caption text-on-surface-variant">Coverage</dt>
              <dd>{completeness}</dd>
            </div>
            <div>
              <dt className="text-caption text-on-surface-variant">Features</dt>
              <dd>{dataset.featureCount.toLocaleString()}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-caption text-on-surface-variant">Geography</dt>
              <dd>{dataset.coverage}</dd>
            </div>
          </dl>
          {dataset.incompleteCoverage && (
            <p className="mt-2 text-caption text-secondary">
              Incomplete geographic coverage — spatial filters may exclude areas incorrectly.
            </p>
          )}
        </section>
        <section>
          <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
            Provenance
          </h3>
          <dl className="space-y-2">
            <div>
              <dt className="text-caption text-on-surface-variant">Source</dt>
              <dd>{dataset.source}</dd>
            </div>
            <div>
              <dt className="text-caption text-on-surface-variant">Version</dt>
              <dd className="font-mono">{dataset.version}</dd>
            </div>
            <div>
              <dt className="text-caption text-on-surface-variant">Data vintage</dt>
              <dd>{dataset.dataVintage ?? "Not recorded"}</dd>
            </div>
            <div>
              <dt className="text-caption text-on-surface-variant">Catalog synced</dt>
              <dd>{formatLocaleDateTime(dataset.updatedAt)}</dd>
            </div>
          </dl>
        </section>
        {dataset.limitations.length > 0 && (
          <section>
            <h3 className="font-mono text-data-label uppercase text-on-surface-variant mb-2">
              Caveats
            </h3>
            <ul className="list-disc pl-4 text-caption text-on-surface-variant space-y-1">
              {dataset.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
      <div className="p-4 border-t border-outline-variant flex gap-2">
        <button
          type="button"
          onClick={onShowOnMap}
          className="flex-1 bg-primary text-on-primary py-2 rounded text-body-sm"
        >
          Show on map
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2 border border-outline-variant rounded text-body-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
