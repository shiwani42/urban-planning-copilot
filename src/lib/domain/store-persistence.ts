import type { AppStore, AnalysisResult, Candidate } from "./types";

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

function hydrateCandidate(
  stored: StoredCandidate,
  limitations: string[],
  byId: Map<string, GeoJSON.Feature>
): Candidate {
  const geometry = lookupGeometry(stored.featureIds, byId);
  const centroid =
    stored.centroid ?? (geometry ? centroidFromGeometry(geometry) : ([0, 0] as [number, number]));
  return {
    ...stored,
    geometry: geometry ?? { type: "Point", coordinates: centroid },
    centroid,
    provenance: {
      scoreBreakdown: Object.fromEntries(
        stored.metrics.filter((m) => m.key.endsWith("_score")).map((m) => [m.key, m.value])
      ),
      calculations: [],
      datasets: [],
      assumptions: [],
      constraints: [],
      humanDecisions: [],
      limitations: [...limitations],
    },
  };
}

/** Reattach parcel geometries from the catalog after loading store.json */
export function hydrateAnalysisResultsInStore(store: AppStore): void {
  const byId = parcelFeaturesById(store);
  for (const result of store.analysisResults) {
    const limitations = result.limitations ?? [];
    result.candidates = (result.candidates as unknown as StoredCandidate[]).map((c) =>
      hydrateCandidate(c, limitations, byId)
    );
  }
}

/** Rough serialized size estimate for PASS-17 diagnostics */
export function estimateStoreJsonBytes(store: AppStore): number {
  return Buffer.byteLength(JSON.stringify(prepareStoreForPersistence(store)), "utf8");
}
