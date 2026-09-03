import type { AppStore, AnalysisResult, Candidate } from "./types";
import { normalizeAnalysisResult, normalizeCandidate } from "./analysis-display";

/** Disk-safe candidate row — geometry lives in featuresByDataset, not store.json */
export type StoredCandidate = Omit<Candidate, "geometry" | "provenance" | "centroid"> & {
  centroid?: [number, number];
};

const PARCEL_KIND = "parcels";

function parcelFeaturesById(store: AppStore): Map<string, GeoJSON.Feature> {
  const parcelsDs = store.datasets.find((d) => d.kind === PARCEL_KIND);
  const fc = parcelsDs ? store.featuresByDataset[parcelsDs.id] : undefined;
  const map = new Map<string, GeoJSON.Feature>();
  if (!fc) return map;
  for (const f of fc.features) {
    const id = String(f.properties?.id ?? f.id ?? "");
    if (id) map.set(id, f);
  }
  return map;
}

function lookupGeometry(
  featureIds: string[],
  byId: Map<string, GeoJSON.Feature>
): GeoJSON.Geometry | undefined {
  for (const fid of featureIds) {
    const f = byId.get(fid);
    if (f?.geometry) return f.geometry;
  }
  return undefined;
}

function centroidFromGeometry(geometry: GeoJSON.Geometry): [number, number] {
  if (geometry.type === "Point") {
    return geometry.coordinates as [number, number];
  }
  if (geometry.type === "Polygon" && geometry.coordinates[0]?.[0]) {
    const ring = geometry.coordinates[0];
    let lng = 0;
    let lat = 0;
    const n = ring.length - 1;
    for (let i = 0; i < n; i++) {
      lng += ring[i][0];
      lat += ring[i][1];
    }
    return [lng / n, lat / n];
  }
  return [0, 0];
}

function compactCandidate(candidate: Candidate): StoredCandidate {
  const { geometry: _geometry, provenance: _provenance, centroid, ...rest } = candidate;
  return {
    ...rest,
    ...(centroid ? { centroid } : {}),
  };
}

function compactAnalysisResult(result: AnalysisResult): AnalysisResult {
  return {
    ...result,
    candidates: result.candidates.map(compactCandidate) as unknown as Candidate[],
  };
}

/** Strip geometries and per-candidate provenance before writing store.json */
export function prepareStoreForPersistence(store: AppStore): AppStore {
  return {
    ...store,
    analysisResults: store.analysisResults.map(compactAnalysisResult),
  };
}

export function hydrateCandidate(
  stored: StoredCandidate,
  limitations: string[],
  byId: Map<string, GeoJSON.Feature>
): Candidate {
  const metrics = Array.isArray(stored.metrics) ? stored.metrics : [];
  const geometry = lookupGeometry(stored.featureIds ?? [], byId);
  const centroid =
    stored.centroid ?? (geometry ? centroidFromGeometry(geometry) : ([0, 0] as [number, number]));
  const base: Candidate = {
    id: stored.id ?? "unknown",
    label: stored.label ?? "Unnamed candidate",
    featureIds: Array.isArray(stored.featureIds) ? stored.featureIds : [],
    geometry: geometry ?? { type: "Point", coordinates: centroid },
    centroid,
    score: typeof stored.score === "number" && Number.isFinite(stored.score) ? stored.score : 0,
    rank: typeof stored.rank === "number" && Number.isFinite(stored.rank) ? stored.rank : 0,
    metrics,
    provenance: {
      scoreBreakdown: Object.fromEntries(
        metrics.filter((m) => m.key.endsWith("_score")).map((m) => [m.key, m.value])
      ),
      calculations: [],
      datasets: [],
      assumptions: [],
      constraints: [],
      humanDecisions: [],
      limitations: [...limitations],
    },
    status: stored.status ?? "eligible",
    rejectionReason: stored.rejectionReason,
    recommendationNote: stored.recommendationNote,
  };
  return normalizeCandidate(base, limitations);
}

function asStoredCandidates(candidates: Candidate[]): StoredCandidate[] {
  return (Array.isArray(candidates) ? candidates : []).map((c) => {
    if (!("geometry" in c) || !c.geometry) {
      return c as unknown as StoredCandidate;
    }
    return compactCandidate(c);
  });
}

/** Normalize analysis rows after load without hydrating every parcel geometry. */
export function prepareAnalysisResultsInStore(store: AppStore): void {
  for (const result of store.analysisResults) {
    const limitations = Array.isArray(result.limitations) ? result.limitations : [];
    result.limitations = limitations;
    result.aggregateMetrics = Array.isArray(result.aggregateMetrics) ? result.aggregateMetrics : [];
    result.candidates = asStoredCandidates(result.candidates).map((stored) =>
      hydrateCandidate(stored, limitations, new Map())
    );
    normalizeAnalysisResult(result);
  }
}

/** Reattach parcel geometries from the catalog — use sparingly (memory heavy). */
export function hydrateAnalysisResultsInStore(
  store: AppStore,
  options?: { all?: boolean; limitPerResult?: number }
): void {
  const byId = parcelFeaturesById(store);
  for (const result of store.analysisResults) {
    const limitations = Array.isArray(result.limitations) ? result.limitations : [];
    result.limitations = limitations;
    result.aggregateMetrics = Array.isArray(result.aggregateMetrics) ? result.aggregateMetrics : [];
    const stored = asStoredCandidates(result.candidates);
    const hydrateCount =
      options?.all === true
        ? stored.length
        : Math.min(stored.length, options?.limitPerResult ?? 0);
    result.candidates = stored.map((c, index) => {
      if (index < hydrateCount) {
        return hydrateCandidate(c, limitations, byId);
      }
      return hydrateCandidate(c, limitations, new Map());
    });
    normalizeAnalysisResult(result);
  }
}

export function hydrateCandidatesInResult(
  store: AppStore,
  result: AnalysisResult,
  candidateIds?: string[]
): void {
  const byId = parcelFeaturesById(store);
  const limitations = Array.isArray(result.limitations) ? result.limitations : [];
  const idSet = candidateIds?.length ? new Set(candidateIds) : null;
  result.candidates = asStoredCandidates(result.candidates).map((stored) => {
    if (idSet && !idSet.has(stored.id)) {
      return hydrateCandidate(stored, limitations, new Map());
    }
    return hydrateCandidate(stored, limitations, byId);
  });
}

export function findCandidateInStore(
  store: AppStore,
  result: AnalysisResult,
  candidateId: string,
  options?: { hydrate?: boolean }
): Candidate | undefined {
  const limitations = Array.isArray(result.limitations) ? result.limitations : [];
  const stored = asStoredCandidates(result.candidates).find(
    (c) => c.id === candidateId || c.featureIds.includes(candidateId)
  );
  if (!stored) return undefined;
  if (!options?.hydrate) {
    return hydrateCandidate(stored, limitations, new Map());
  }
  const byId = parcelFeaturesById(store);
  return hydrateCandidate(stored, limitations, byId);
}

/** Rough serialized size estimate for PASS-17 diagnostics */
export function estimateStoreJsonBytes(store: AppStore): number {
  return Buffer.byteLength(JSON.stringify(prepareStoreForPersistence(store)), "utf8");
}
