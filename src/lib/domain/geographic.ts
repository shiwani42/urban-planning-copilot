import * as turf from "@turf/turf";
import type { GeographicSelection } from "./types";

/** Default label prefix for human-drawn exclusion polygons. */
export function defaultExclusionLabel(type: GeographicSelection["type"]): string {
  return type === "inclusion" ? "Inclusion area" : "Exclusion area";
}

/** Produce a unique planner-facing label among existing geographic selections. */
export function uniqueGeographicLabel(
  existing: GeographicSelection[],
  type: GeographicSelection["type"],
  preferred?: string
): string {
  const base = (preferred?.trim() || defaultExclusionLabel(type)).replace(/\s+\(\d+\)$/, "");
  const labels = new Set(existing.map((s) => s.label.toLowerCase()));
  if (!labels.has(base.toLowerCase())) return base;
  let i = 2;
  while (labels.has(`${base} (${i})`.toLowerCase())) i += 1;
  return `${base} (${i})`;
}

/** Closed polygon ring coordinates (without duplicate closing vertex). */
export function ringFromPolygon(
  geometry: GeoJSON.Polygon | GeoJSON.MultiPolygon
): number[][] {
  if (geometry.type === "Polygon") {
    const ring = geometry.coordinates[0] ?? [];
    if (ring.length > 1) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      if (first[0] === last[0] && first[1] === last[1]) {
        return ring.slice(0, -1);
      }
    }
    return ring;
  }
  const firstPoly = geometry.coordinates[0]?.[0] ?? [];
  return firstPoly;
}

export function polygonFromRing(ring: number[][]): GeoJSON.Polygon {
  const closed =
    ring.length >= 3
      ? ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
        ? ring
        : [...ring, ring[0]]
      : ring;
  return { type: "Polygon", coordinates: [closed] };
}

/** Parcel / feature ids whose geometry intersects any exclusion selection. */
export function featureIdsInExclusions(
  features: GeoJSON.Feature[],
  selections: GeographicSelection[]
): Set<string> {
  const exclusions = selections.filter((s) => s.type === "exclusion");
  const ids = new Set<string>();
  if (!exclusions.length) return ids;

  for (const f of features) {
    const id = String(f.properties?.id ?? f.id ?? "");
    for (const sel of exclusions) {
      try {
        if (turf.booleanIntersects(f, turf.feature(sel.geometry))) {
          ids.add(id);
          break;
        }
      } catch {
        /* skip invalid geometry */
      }
    }
  }
  return ids;
}
