/** Study area bounds — San Francisco Mission & SoMa. */
export const STUDY_BOUNDS = {
  west: -122.418,
  south: 37.758,
  east: -122.408,
  north: 37.772,
};

export const GEOGRAPHY_LABEL = "Mission/SoMa, San Francisco";

/** Legacy rows stored "Study area" — never show that to planners. */
export function displayGeographyLabel(raw?: string | null): string {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "Study area") return GEOGRAPHY_LABEL;
  return trimmed;
}
