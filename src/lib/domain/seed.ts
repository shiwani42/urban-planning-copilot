/**
 * Synthetic supplement geography for layers not yet ingested from SF open data.
 * Real parcels / transit / flood come from checked-in snapshots (see sf-data.ts).
 */
import * as turf from "@turf/turf";
import type { DatasetMeta } from "./types";
import { STUDY_BOUNDS, GEOGRAPHY_LABEL } from "./study-bounds";

export { STUDY_BOUNDS, GEOGRAPHY_LABEL } from "./study-bounds";

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function cellPolygon(
  west: number,
  south: number,
  east: number,
  north: number
): GeoJSON.Feature<GeoJSON.Polygon> {
  return turf.bboxPolygon([west, south, east, north]);
}

export function generateSyntheticCity(seed = 42): {
  datasets: DatasetMeta[];
  featuresByDataset: Record<string, GeoJSON.FeatureCollection>;
} {
  const rand = seededRandom(seed);
  const { west, south, east, north } = STUDY_BOUNDS;
  const cols = 12;
  const rows = 10;
  const dx = (east - west) / cols;
  const dy = (north - south) / rows;

  const zoningOptions = ["R1", "R2", "R3", "MX", "MU", "C1", "I1", "OS"];
  const parcels: GeoJSON.Feature[] = [];
  let idx = 0;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const jitter = 0.15;
      const w = west + c * dx + dx * jitter * 0.1;
      const s = south + r * dy + dy * jitter * 0.1;
      const e = w + dx * (0.85 + rand() * 0.1);
      const n = s + dy * (0.85 + rand() * 0.1);
      const zoning = zoningOptions[Math.floor(rand() * zoningOptions.length)];
      const area = turf.area(cellPolygon(w, s, e, n));
      const density =
        zoning.startsWith("R") || zoning.startsWith("M")
          ? 40 + Math.floor(rand() * 120)
          : 10 + Math.floor(rand() * 30);
      const existing = Math.floor(rand() * 40);
      const feature = cellPolygon(w, s, e, n);
      const name =
        r > 6 && c < 4
          ? `Riverside ${String.fromCharCode(65 + (idx % 8))}-${r}${c}`
          : r < 3 && c > 7
            ? `Upland ${String.fromCharCode(65 + (c % 8))}-${r}${c}`
            : `Block ${r}-${c}`;
      feature.properties = {
        id: `parcel-${idx}`,
        name,
        zoning,
        land_use: zoning.startsWith("R") || zoning.startsWith("M") ? "residential" : "other",
        area_sqm: Math.round(area),
        density_uph: density,
        existing_units: existing,
        synthetic: true,
      };
      feature.id = `parcel-${idx}`;
      parcels.push(feature);
      idx++;
    }
  }

  const width = east - west;
  const height = north - south;

  // Transit stations along a corridor
  const transit: GeoJSON.Feature[] = [];
  for (let i = 0; i < 8; i++) {
    const lng = west + width * 0.08 + i * (width * 0.84 / 7);
    const lat =
      south + height * 0.12 + (i % 3) * (height * 0.22) + rand() * (height * 0.04);
    transit.push(
      turf.point([lng, lat], {
        id: `transit-${i}`,
        name: `Station ${i + 1}`,
        type: i % 2 === 0 ? "rail" : "bus",
        service_freq: 5 + Math.floor(rand() * 20),
        synthetic: true,
      })
    );
  }

  // Flood zones near southern/western river edge
  const flood: GeoJSON.Feature[] = [
    turf.bboxPolygon([west, south, west + (east - west) * 0.45, south + (north - south) * 0.28], {
      properties: {
        id: "flood-high-1",
        risk: "high",
        name: "River corridor high risk",
        synthetic: true,
      },
    }),
    turf.bboxPolygon(
      [
        west + (east - west) * 0.2,
        south + (north - south) * 0.2,
        west + (east - west) * 0.55,
        south + (north - south) * 0.4,
      ],
      {
        properties: {
          id: "flood-mod-1",
          risk: "moderate",
          name: "Moderate flood fringe",
          synthetic: true,
        },
      }
    ),
  ];

  // Population grid
  const population: GeoJSON.Feature[] = [];
  let pidx = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const lng = west + (c + 0.5) * dx;
      const lat = south + (r + 0.5) * dy;
      const pop = Math.floor(80 + rand() * 600 + (r < 4 ? 200 : 0));
      population.push(
        turf.point([lng, lat], {
          id: `pop-${pidx}`,
          population: pop,
          synthetic: true,
        })
      );
      pidx++;
    }
  }

  // Schools
  const schools: GeoJSON.Feature[] = [];
  for (let i = 0; i < 5; i++) {
    schools.push(
      turf.point(
        [
          west + width * 0.05 + rand() * width * 0.9,
          south + height * 0.05 + rand() * height * 0.9,
        ],
        {
          id: `school-${i}`,
          name: `School ${i + 1}`,
          type: "primary",
          synthetic: true,
        }
      )
    );
  }

  // Parks / green spaces
  const parks: GeoJSON.Feature[] = [];
  for (let i = 0; i < 6; i++) {
    const lng = west + 0.03 + rand() * (east - west - 0.06);
    const lat = south + 0.03 + rand() * (north - south - 0.06);
    const size = 0.003 + rand() * 0.004;
    parks.push(
      turf.bboxPolygon([lng, lat, lng + size, lat + size * 0.8], {
        properties: {
          id: `park-${i}`,
          name: `Park ${i + 1}`,
          type: i % 2 === 0 ? "neighborhood_park" : "playground",
          synthetic: true,
        },
      })
    );
  }

  // Roads / infrastructure (sample points representing access nodes)
  const infrastructure: GeoJSON.Feature[] = [];
  for (let i = 0; i < 15; i++) {
    infrastructure.push(
      turf.point(
        [
          west + rand() * (east - west),
          south + rand() * (north - south),
        ],
        {
          id: `infra-${i}`,
          type: i % 3 === 0 ? "water" : i % 3 === 1 ? "power" : "road",
          name: `Infrastructure node ${i + 1}`,
          synthetic: true,
        }
      )
    );
  }

  const now = new Date().toISOString();
  const datasets: DatasetMeta[] = [
    {
      id: "ds-parcels",
      name: "Parcels (Illustrative supplement)",
      kind: "parcels",
      source: "Synthetic generator — not used when SF snapshot is loaded",
      version: "syn-1.0.0",
      updatedAt: now,
      dataVintage: "2024 municipal assessor roll (synthetic)",
      synthetic: true,
      coverage: GEOGRAPHY_LABEL,
      limitations: [
        "Synthetic geometry for demonstration and testing",
        "Zoning codes are illustrative",
      ],
      featureCount: parcels.length,
      enabled: true,
      attributes: ["id", "name", "zoning", "area_sqm", "density_uph", "existing_units"],
    },
    {
      id: "ds-transit",
      name: "Transit stops (Synthetic)",
      kind: "transit",
      source: "Synthetic generator",
      version: "syn-1.0.0",
      updatedAt: now,
      dataVintage: "2023 GTFS snapshot (synthetic)",
      synthetic: true,
      coverage: GEOGRAPHY_LABEL,
      limitations: ["Stop locations are illustrative", "Frequencies are illustrative"],
      featureCount: transit.length,
      enabled: true,
      attributes: ["id", "name", "type", "service_freq"],
    },
    {
      id: "ds-flood",
      name: "Flood risk zones (Synthetic)",
      kind: "flood",
      source: "Synthetic generator",
      version: "syn-1.0.0",
      updatedAt: now,
      dataVintage: "2022 FEMA-style floodplain (synthetic, partial)",
      synthetic: true,
      coverage: "Partial river corridor — incomplete east side coverage",
      limitations: [
        "Synthetic flood extents",
        "Eastern uplands have incomplete flood mapping",
      ],
      featureCount: flood.length,
      enabled: true,
      incompleteCoverage: true,
      attributes: ["id", "risk", "name"],
    },
    {
      id: "ds-population",
      name: "Population grid (Synthetic)",
      kind: "population",
      source: "Synthetic generator",
      version: "syn-1.0.0",
      updatedAt: now,
      dataVintage: "2021 census-style grid (synthetic)",
      synthetic: true,
      coverage: "Study area grid",
      limitations: ["Not census-accurate", "Point representation of areal estimates", "May double-count near parcel boundaries"],
      featureCount: population.length,
      enabled: true,
      attributes: ["id", "population"],
    },
    {
      id: "ds-schools",
      name: "Schools (Synthetic)",
      kind: "schools",
      source: "Synthetic generator",
      version: "syn-1.0.0",
      updatedAt: now,
      dataVintage: "2024 school district inventory (synthetic)",
      synthetic: true,
      coverage: "Study area",
      limitations: [
        "School locations are synthetic",
        "Does not distinguish school capacity or enrollment",
      ],
      featureCount: schools.length,
      enabled: true,
      attributes: ["id", "name", "type"],
    },
    {
      id: "ds-parks",
      name: "Parks & green space (Synthetic)",
      kind: "parks",
      source: "Synthetic generator",
      version: "syn-1.0.0",
      updatedAt: now,
      synthetic: true,
      coverage: "Study area — illustrative park footprints",
      limitations: [
        "Park boundaries are synthetic",
        "Does not include trail networks or informal open space",
      ],
      featureCount: parks.length,
      enabled: true,
      attributes: ["id", "name", "type"],
    },
    {
      id: "ds-infrastructure",
      name: "Infrastructure nodes (Synthetic)",
      kind: "infrastructure",
      source: "Synthetic generator",
      version: "syn-1.0.0",
      updatedAt: now,
      dataVintage: "2023 utility node sample (synthetic)",
      synthetic: true,
      coverage: "Study area sample",
      limitations: ["Sparse sample of infrastructure access points"],
      featureCount: infrastructure.length,
      enabled: true,
      attributes: ["id", "name", "type"],
    },
  ];

  return {
    datasets,
    featuresByDataset: {
      "ds-parcels": { type: "FeatureCollection", features: parcels },
      "ds-transit": { type: "FeatureCollection", features: transit },
      "ds-flood": { type: "FeatureCollection", features: flood },
      "ds-population": { type: "FeatureCollection", features: population },
      "ds-schools": { type: "FeatureCollection", features: schools },
      "ds-parks": { type: "FeatureCollection", features: parks },
      "ds-infrastructure": { type: "FeatureCollection", features: infrastructure },
    },
  };
}
