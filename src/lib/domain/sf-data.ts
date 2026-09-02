/**
 * San Francisco open-data snapshots (Pass 09) — loaded from checked-in gzipped GeoJSON.
 * Refresh snapshots with: npm run ingest:sf
 */
import { promises as fs } from "fs";
import path from "path";
import type { DatasetMeta } from "./types";
import { generateSyntheticCity } from "./seed";
import { GEOGRAPHY_LABEL, STUDY_BOUNDS } from "./study-bounds";

export { GEOGRAPHY_LABEL, STUDY_BOUNDS };

const SF_DIR = path.join(process.cwd(), "data", "sf");

const SOURCE_URLS = {
  parcels: "https://data.sfgov.org/d/acdm-wktn",
  transit: "https://data.sfgov.org/Transportation/Muni-Stops/i28k-bkz6",
  flood:
    "https://data.sfgov.org/Public-Safety/100-Year-Storm-Flood-Risk-Zone-July-2022-/jzu3-4yxp",
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
      synthetic: false,
      coverage: GEOGRAPHY_LABEL,
      limitations: [
        "Snapshot clipped to Mission & SoMa demo AOI — not full city coverage",
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
      synthetic: false,
      coverage: GEOGRAPHY_LABEL,
      limitations: [
        "Snapshot near demo AOI — not live 511.org feed",
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
      synthetic: false,
      coverage: "Clipped to demo AOI from citywide SFPUC layer",
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

/** Synthetic layers not yet replaced by city open data in Pass 09. */
export function syntheticSupplementDatasets(now: string): {
  datasets: DatasetMeta[];
  featuresByDataset: Record<string, GeoJSON.FeatureCollection>;
} {
  const city = generateSyntheticCity(99);
  const kinds = ["population", "schools", "infrastructure"] as const;
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
