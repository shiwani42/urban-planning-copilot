/**
 * San Francisco open-data snapshots (Pass 09) — loaded from checked-in gzipped GeoJSON.
 * Refresh snapshots with: npm run ingest:sf
 */
import { promises as fs } from "fs";
import path from "path";
import type { DatasetMeta } from "./types";
import { generateSyntheticCity } from "./seed";
import { GEOGRAPHY_LABEL, STUDY_BOUNDS } from "./study-bounds";
import { getSfSnapshotsDir } from "./snapshot-paths";

export { GEOGRAPHY_LABEL, STUDY_BOUNDS };

const SF_DIR = getSfSnapshotsDir();

const SOURCE_URLS = {
  parcels: "https://data.sfgov.org/d/acdm-wktn",
  transit: "https://data.sfgov.org/Transportation/Muni-Stops/i28k-bkz6",
  flood:
    "https://data.sfgov.org/Public-Safety/100-Year-Storm-Flood-Risk-Zone-July-2022-/jzu3-4yxp",
  parks: "https://data.sfgov.org/Culture-and-Recreation/Recreation-and-Parks-Properties/gtr9-ntp6",
  schools: "https://data.sfgov.org/Economy-and-Community/Schools/7e7j-59qk",
};

type Manifest = {
  generatedAt?: string;
  aoi?: { label?: string };
  layers?: Record<
    string,
    { featureCount?: number; vintage?: string; path?: string; bytes?: number }
  >;
};

async function readGzJson<T>(filename: string): Promise<T> {
  const filePath = path.join(SF_DIR, filename);
  const raw = await fs.readFile(filePath);
  const { gunzipSync } = await import("zlib");
  const text = gunzipSync(raw).toString("utf8");
  return JSON.parse(text) as T;
}

async function loadManifest(): Promise<Manifest | null> {
  try {
    const raw = await fs.readFile(path.join(SF_DIR, "manifest.json"), "utf8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

function vintageToVersion(vintage?: string): string {
  if (!vintage) return "snapshot";
  const d = new Date(vintage);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return vintage.slice(0, 10);
}

function provenanceSource(kind: keyof typeof SOURCE_URLS): string {
  return `${SOURCE_URLS[kind]} (PDDL)`;
}

function dataVintageLabel(vintage?: string, fallback?: string): string | undefined {
  const formatted = vintage ? vintageToVersion(vintage) : undefined;
  return formatted ?? fallback;
}

export async function loadSanFranciscoCity(): Promise<{
  datasets: DatasetMeta[];
  featuresByDataset: Record<string, GeoJSON.FeatureCollection>;
  available: boolean;
}> {
  const manifest = await loadManifest();
  const parcelsPath = path.join(SF_DIR, "parcels.geojson.gz");
  try {
    await fs.access(parcelsPath);
  } catch {
    return { datasets: [], featuresByDataset: {}, available: false };
  }

  const parcels = await readGzJson<GeoJSON.FeatureCollection>("parcels.geojson.gz");
  const transit = await readGzJson<GeoJSON.FeatureCollection>("transit.geojson.gz");
  const flood = await readGzJson<GeoJSON.FeatureCollection>("flood.geojson.gz");

  const parcelVintage = manifest?.layers?.parcels?.vintage;
  const transitVintage = manifest?.layers?.transit?.vintage;
  const floodVintage = manifest?.layers?.flood?.vintage;
  const generatedAt = manifest?.generatedAt ?? new Date().toISOString();

  const datasets: DatasetMeta[] = [
    {
      id: "ds-parcels",
      name: "Active parcels (San Francisco)",
      kind: "parcels",
      source: provenanceSource("parcels"),
      version: vintageToVersion(parcelVintage),
      updatedAt: generatedAt,
      dataVintage: dataVintageLabel(parcelVintage, "SF assessor roll snapshot"),
      synthetic: false,
      coverage: GEOGRAPHY_LABEL,
      limitations: [
        "Covers Mission/SoMa study area only — not the full city",
        "Simplified geometries for browser performance",
        "Capacity estimates use illustrative density assumptions",
      ],
      featureCount: parcels.features.length,
      enabled: true,
      attributes: [
        "id",
        "blklot",
        "zoning",
        "zoning_code",
        "zoning_district",
        "analysis_neighborhood",
        "land_use",
        "area_sqm",
      ],
    },
    {
      id: "ds-transit",
      name: "Muni stops (San Francisco)",
      kind: "transit",
      source: provenanceSource("transit"),
      version: vintageToVersion(transitVintage),
      updatedAt: generatedAt,
      dataVintage: dataVintageLabel(transitVintage, "Muni stops snapshot"),
      synthetic: false,
      coverage: GEOGRAPHY_LABEL,
      limitations: [
        "Point-in-time Muni stop inventory for the study area — not a live feed",
        "Stop inventory reflects Muni open data vintage",
      ],
      featureCount: transit.features.length,
      enabled: true,
      attributes: ["id", "name", "stopid", "type"],
    },
    {
      id: "ds-flood",
      name: "SFPUC 100-year storm flood risk",
      kind: "flood",
      source: provenanceSource("flood"),
      version: vintageToVersion(floodVintage),
      updatedAt: generatedAt,
      dataVintage: dataVintageLabel(floodVintage, "2022-07 SFPUC 100-year storm model"),
      synthetic: false,
      coverage: "Mission/SoMa clip from citywide SFPUC layer",
      limitations: [
        "July 2022 SFPUC storm flood model — not FEMA NFHL",
        "Partial clip — verify site-specific risk before decisions",
      ],
      featureCount: flood.features.length,
      enabled: true,
      incompleteCoverage: true,
      attributes: ["id", "risk", "name"],
    },
  ];

  return {
    datasets,
    featuresByDataset: {
      "ds-parcels": parcels,
      "ds-transit": transit,
      "ds-flood": flood,
    },
    available: true,
  };
}

/** Mission/SoMa Recreation and Parks clip — loadable even when parcel snapshots are absent. */
export async function loadSanFranciscoParks(): Promise<{
  dataset: DatasetMeta;
  features: GeoJSON.FeatureCollection;
} | null> {
  const parksPath = path.join(SF_DIR, "parks.geojson.gz");
  try {
    await fs.access(parksPath);
  } catch {
    return null;
  }
  const parks = await readGzJson<GeoJSON.FeatureCollection>("parks.geojson.gz");
  if (!parks.features.length) return null;
  const manifest = await loadManifest();
  const vintage = manifest?.layers?.parks?.vintage;
  const generatedAt = manifest?.generatedAt ?? new Date().toISOString();
  return {
    dataset: {
      id: "ds-parks",
      name: "Recreation and Parks (San Francisco)",
      kind: "parks",
      source: provenanceSource("parks"),
      version: vintageToVersion(vintage),
      updatedAt: generatedAt,
      dataVintage: dataVintageLabel(vintage, "SF Recreation and Parks properties"),
      synthetic: false,
      coverage: GEOGRAPHY_LABEL,
      limitations: [
        "Mission/SoMa clip of Recreation and Parks properties — not the full city",
        "Does not include informal open space or privately owned public space",
      ],
      featureCount: parks.features.length,
      enabled: true,
      attributes: ["id", "name", "type", "neighborhood"],
    },
    features: parks,
  };
}

export async function loadSanFranciscoSchools(): Promise<{
  dataset: DatasetMeta;
  features: GeoJSON.FeatureCollection;
} | null> {
  const schoolsPath = path.join(SF_DIR, "schools.geojson.gz");
  try {
    await fs.access(schoolsPath);
  } catch {
    return null;
  }
  const schools = await readGzJson<GeoJSON.FeatureCollection>("schools.geojson.gz");
  if (!schools.features.length) return null;
  const manifest = await loadManifest();
  const vintage = manifest?.layers?.schools?.vintage;
  const generatedAt = manifest?.generatedAt ?? new Date().toISOString();
  return {
    dataset: {
      id: "ds-schools",
      name: "Schools (San Francisco)",
      kind: "schools",
      source: provenanceSource("schools"),
      version: vintageToVersion(vintage),
      updatedAt: generatedAt,
      dataVintage: dataVintageLabel(vintage, "SF schools snapshot"),
      synthetic: false,
      coverage: GEOGRAPHY_LABEL,
      limitations: [
        "Mission/SoMa clip of active school sites — not the full city",
        "Point locations, not campus footprints",
      ],
      featureCount: schools.features.length,
      enabled: true,
      attributes: ["id", "name", "type", "neighborhood", "district", "grades"],
    },
    features: schools,
  };
}

type SnapshotStore = {
  datasets: DatasetMeta[];
  featuresByDataset: Record<string, GeoJSON.FeatureCollection>;
};

async function attachCitySnapshotLayer(
  store: SnapshotStore,
  kind: "parks" | "schools",
  loaded: { dataset: DatasetMeta; features: GeoJSON.FeatureCollection } | null
): Promise<boolean> {
  if (!loaded) return false;
  const hasCityParcels = store.datasets.some((d) => d.kind === "parcels" && !d.synthetic);
  if (!hasCityParcels) return false;
  const existing = store.datasets.find((d) => d.kind === kind);
  if (existing && !existing.synthetic && existing.id === loaded.dataset.id) {
    store.featuresByDataset[existing.id] = loaded.features;
    existing.featureCount = loaded.features.features.length;
    existing.name = loaded.dataset.name;
    existing.source = loaded.dataset.source;
    existing.limitations = loaded.dataset.limitations;
    existing.synthetic = false;
    return false;
  }
  if (existing) {
    store.datasets = store.datasets.filter((d) => d.id !== existing.id);
    delete store.featuresByDataset[existing.id];
  }
  store.datasets.push(loaded.dataset);
  store.featuresByDataset[loaded.dataset.id] = loaded.features;
  return true;
}

/** Attach or replace synthetic parks with the checked-in SF clip. Memory only — do not persist the GIS catalog. */
export async function attachSanFranciscoParks(store: SnapshotStore): Promise<boolean> {
  return attachCitySnapshotLayer(store, "parks", await loadSanFranciscoParks());
}

/** Attach or replace illustrative schools with the checked-in SF clip. Memory only. */
export async function attachSanFranciscoSchools(store: SnapshotStore): Promise<boolean> {
  return attachCitySnapshotLayer(store, "schools", await loadSanFranciscoSchools());
}

export async function attachSanFranciscoSnapshotLayers(store: SnapshotStore): Promise<void> {
  await attachSanFranciscoParks(store);
  await attachSanFranciscoSchools(store);
}

/** Synthetic layers not yet replaced by city open data (population, infrastructure). */
export function syntheticSupplementDatasets(now: string): {
  datasets: DatasetMeta[];
  featuresByDataset: Record<string, GeoJSON.FeatureCollection>;
} {
  const city = generateSyntheticCity(99);
  const kinds = ["population", "infrastructure"] as const;
  const datasets = city.datasets.filter((d) => kinds.includes(d.kind as typeof kinds[number]));
  const featuresByDataset: Record<string, GeoJSON.FeatureCollection> = {};
  for (const d of datasets) {
    featuresByDataset[d.id] = city.featuresByDataset[d.id];
    d.name = d.name.replace("Synthetic", "Illustrative");
    d.limitations = [
      ...d.limitations,
      "Not San Francisco open data — illustrative until a future ingest pass",
    ];
    d.updatedAt = now;
  }
  return { datasets, featuresByDataset };
}
