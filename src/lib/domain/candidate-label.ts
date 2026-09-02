import type { FeatureProps } from "./spatial";

type ParcelProps = FeatureProps &
  Record<string, unknown> & {
    blklot?: string;
    block_lot?: string;
    block_num?: string | number;
    block?: string | number;
    analysis_neighborhood?: string;
    neighborhood?: string;
  };

/** Human-readable parcel label for ranked candidates (block / neighborhood / blklot). */
export function candidateLabelFromFeature(
  feature: GeoJSON.Feature,
  id: string
): string {
  const p = (feature.properties ?? {}) as ParcelProps;
  const neighborhood = String(
    p.analysis_neighborhood ?? p.neighborhood ?? ""
  ).trim();
  const blklot = String(p.blklot ?? p.block_lot ?? "").trim();
  const block = String(p.block_num ?? p.block ?? "").trim();
  const name = String(p.name ?? "").trim();

  if (neighborhood && blklot) return `${neighborhood} — Blk/Lot ${blklot}`;
  if (blklot) return `Blk/Lot ${blklot}`;
  if (neighborhood && block) return `${neighborhood} — Block ${block}`;
  if (name && name !== String(id)) return name;
  if (neighborhood) return `${neighborhood} (parcel ${id})`;
  if (block) return `Block ${block} (parcel ${id})`;
  return `Parcel ${id}`;
}
