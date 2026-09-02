/**
 * Snapshot San Francisco open data for offline serving (Pass 09).
 * Does not run at request time — refresh with: npm run ingest:sf
 *
 * Sources (PDDL / city open data):
 * - Parcels: https://data.sfgov.org/d/acdm-wktn
 * - Muni stops: https://data.sfgov.org/Transportation/Muni-Stops/i28k-bkz6
 * - 100-year storm flood: https://data.sfgov.org/Public-Safety/100-Year-Storm-Flood-Risk-Zone-July-2022-/jzu3-4yxp
 */
import { createWriteStream, mkdirSync, writeFileSync } from "fs";
import { createGzip } from "zlib";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import path from "path";
import { fileURLToPath } from "url";
import * as turf from "@turf/turf";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "data", "sf");

/** Demo AOI: Mission + SoMa core (not live-filtered at runtime). */
export const DEMO_AOI = {
  west: -122.418,
  south: 37.758,
  east: -122.408,
  north: 37.772,
  neighborhoods: ["Mission", "South of Market"],
  label: "San Francisco — Mission & SoMa demo area",
};

const SOURCES = {
  parcels: {
    id: "acdm-wktn",
    url: "https://data.sfgov.org/resource/acdm-wktn.geojson",
    license: "PDDL",
    vintageField: "data_as_of",
  },
  transit: {
    id: "i28k-bkz6",
    url: "https://data.sfgov.org/resource/i28k-bkz6.geojson",
    license: "PDDL",
    vintageField: "data_as_of",
  },
  flood: {
    id: "jzu3-4yxp",
    url: "https://data.sfgov.org/resource/jzu3-4yxp.geojson",
    license: "PDDL",
    vintageField: "data_as_of",
  },
};

const PAGE_SIZE = 1000;
const SIMPLIFY_TOLERANCE = 0.00006; // ~6 m — keeps parcels light for browser + Render

function withinBoxWhere(column) {
  const { north, west, south, east } = DEMO_AOI;
  return `within_box(${column}, ${north}, ${west}, ${south}, ${east})`;
}

function neighborhoodList() {
  return DEMO_AOI.neighborhoods.map((n) => `'${n.replace(/'/g, "''")}'`).join(",");
}

async function fetchJson(url, params) {
  const qs = new URLSearchParams(params);
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Fetch failed ${res.status} ${url}: ${body.slice(0, 400)}`);
  }
  return res.json();
}

async function fetchAllGeoJson(url, where) {
  const features = [];
  let offset = 0;
  for (;;) {
    const page = await fetchJson(url, {
      $where: where,
      $limit: String(PAGE_SIZE),
      $offset: String(offset),
    });
    const batch = page.features ?? [];
    if (!batch.length) break;
    features.push(...batch);
    if (batch.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    process.stdout.write(`  … ${features.length} features\r`);
  }
  return { type: "FeatureCollection", features };
}

function toPolygonGeometry(geom) {
  if (!geom) return null;
  if (geom.type === "Polygon" || geom.type === "MultiPolygon") return geom;
  return null;
}

function simplifyFeature(feature) {
  try {
    const simplified = turf.simplify(feature, {
      tolerance: SIMPLIFY_TOLERANCE,
      highQuality: false,
      mutate: false,
    });
    return simplified;
  } catch {
    return feature;
  }
}

function clipToAoi(feature) {
  const bbox = [
    DEMO_AOI.west,
    DEMO_AOI.south,
    DEMO_AOI.east,
    DEMO_AOI.north,
  ];
  const box = turf.bboxPolygon(bbox);
  try {
    const clipped = turf.intersect(turf.featureCollection([feature, box]));
    return clipped;
  } catch {
    return null;
  }
}

function mapParcelFeature(raw, index) {
  const props = raw.properties ?? {};
  const blklot = String(props.blklot ?? props.mapblklot ?? `parcel-${index}`);
  const zoningCode = String(props.zoning_code ?? "");
  const simplified = simplifyFeature(raw);
  const geom = toPolygonGeometry(simplified.geometry);
  if (!geom) return null;

  const residential =
    /^(RH|RM|RC|RPD|RTO|RED|RES|NCT)/i.test(zoningCode) ||
    /RESIDENTIAL/i.test(String(props.zoning_district ?? ""));

  return {
    type: "Feature",
    id: blklot,
    geometry: geom,
    properties: {
      id: blklot,
      blklot,
      name: blklot,
      zoning: zoningCode,
      zoning_code: zoningCode,
      zoning_district: String(props.zoning_district ?? ""),
      analysis_neighborhood: String(props.analysis_neighborhood ?? ""),
      land_use: residential ? "residential" : "other",
      area_sqm: Math.round(turf.area(simplified)),
      density_uph: residential ? 80 : 20,
      existing_units: 0,
      synthetic: false,
    },
  };
}

function mapTransitFeature(raw, index) {
  const props = raw.properties ?? {};
  const stopId = String(props.stopid ?? props.objectid ?? `stop-${index}`);
  let geom = raw.geometry;
  if (!geom && props.longitude && props.latitude) {
    geom = {
      type: "Point",
      coordinates: [Number(props.longitude), Number(props.latitude)],
    };
  }
  if (!geom || geom.type !== "Point") return null;

  const [lng, lat] = geom.coordinates;
  const pad = 0.004;
  if (
    lng < DEMO_AOI.west - pad ||
    lng > DEMO_AOI.east + pad ||
    lat < DEMO_AOI.south - pad ||
    lat > DEMO_AOI.north + pad
  ) {
    return null;
  }

  return {
    type: "Feature",
    id: stopId,
    geometry: geom,
    properties: {
      id: stopId,
      name: String(props.stopname ?? `Muni stop ${stopId}`),
      type: String(props.serviceplanningstoptype ?? "bus"),
      stopid: stopId,
      synthetic: false,
    },
  };
}

function mapFloodFeature(raw, index) {
  const simplified = simplifyFeature(raw);
  let geom = toPolygonGeometry(simplified.geometry);
  if (!geom) return null;

  const clipped = clipToAoi({ type: "Feature", geometry: geom, properties: {} });
  if (!clipped?.geometry) return null;

  geom = clipped.geometry;
  if (turf.area({ type: "Feature", geometry: geom, properties: {} }) < 1) return null;

  return {
    type: "Feature",
    id: `flood-${index}`,
    geometry: geom,
    properties: {
      id: `flood-${index}`,
      risk: "high",
      name: "SFPUC 100-year storm flood risk zone",
      synthetic: false,
    },
  };
}

async function writeGzJson(filename, data) {
  const json = JSON.stringify(data);
  const outPath = path.join(OUT_DIR, filename);
  const gzip = createGzip();
  const source = Readable.from(json);
  const dest = createWriteStream(outPath);
  await pipeline(source, gzip, dest);
  return { path: outPath, bytes: Buffer.byteLength(json, "utf8") };
}

function pickVintage(features, field) {
  for (const f of features) {
    const v = f.properties?.[field];
    if (v) return String(v);
  }
  return new Date().toISOString().slice(0, 10);
}

async function ingestParcels() {
  console.log("Parcels…");
  const where = `active=true AND analysis_neighborhood in(${neighborhoodList()}) AND ${withinBoxWhere("shape")}`;
  const raw = await fetchAllGeoJson(SOURCES.parcels.url, where);
  const features = raw.features
    .map((f, i) => mapParcelFeature(f, i))
    .filter(Boolean);
  console.log(`  ${features.length} parcels (simplified)`);
  const vintage = pickVintage(raw.features, SOURCES.parcels.vintageField);
  const file = await writeGzJson("parcels.geojson.gz", {
    type: "FeatureCollection",
    features,
  });
  const relPath = path.join("data", "sf", "parcels.geojson.gz");
  return { kind: "parcels", featureCount: features.length, vintage, path: relPath, bytes: file.bytes };
}

async function ingestTransit() {
  console.log("Muni stops…");
  // Wider fetch box so corridors near the parcel AOI still supply stops; clip to study bounds.
  const { north, west, south, east } = DEMO_AOI;
  const pad = 0.004;
  const where = `within_box(shape, ${north + pad}, ${west - pad}, ${south - pad}, ${east + pad})`;
  const raw = await fetchAllGeoJson(SOURCES.transit.url, where);
  const features = raw.features
    .map((f, i) => mapTransitFeature(f, i))
    .filter(Boolean);
  console.log(`  ${features.length} stops`);
  const vintage = pickVintage(raw.features, SOURCES.transit.vintageField);
  const file = await writeGzJson("transit.geojson.gz", {
    type: "FeatureCollection",
    features,
  });
  const relPath = path.join("data", "sf", "transit.geojson.gz");
  return { kind: "transit", featureCount: features.length, vintage, path: relPath, bytes: file.bytes };
}

async function ingestFlood() {
  console.log("Flood zones…");
  const raw = await fetchJson(SOURCES.flood.url, { $limit: "10" });
  const features = (raw.features ?? [])
    .flatMap((f, i) => {
      const mapped = mapFloodFeature(f, i);
      if (!mapped) return [];
      if (mapped.geometry.type === "MultiPolygon") {
        return mapped.geometry.coordinates.map((coords, j) => ({
          type: "Feature",
          id: `flood-${i}-${j}`,
          geometry: { type: "Polygon", coordinates: coords },
          properties: { ...mapped.properties, id: `flood-${i}-${j}` },
        }));
      }
      return [mapped];
    });
  console.log(`  ${features.length} flood polygons (clipped to AOI)`);
  const vintage = pickVintage(raw.features ?? [], SOURCES.flood.vintageField);
  const file = await writeGzJson("flood.geojson.gz", {
    type: "FeatureCollection",
    features,
  });
  const relPath = path.join("data", "sf", "flood.geojson.gz");
  return { kind: "flood", featureCount: features.length, vintage, path: relPath, bytes: file.bytes };
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  console.log(`Writing snapshots to ${OUT_DIR}`);
  console.log(`AOI: ${DEMO_AOI.label}`);

  const results = {
    generatedAt: new Date().toISOString(),
    aoi: DEMO_AOI,
    sources: SOURCES,
    layers: {},
  };

  results.layers.parcels = await ingestParcels();
  results.layers.transit = await ingestTransit();
  results.layers.flood = await ingestFlood();

  writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(results, null, 2));
  console.log("Done.");
  for (const [k, v] of Object.entries(results.layers)) {
    console.log(`  ${k}: ${v.featureCount} features, ${v.bytes} bytes JSON → ${v.path}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
