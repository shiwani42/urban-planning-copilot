/** Walk / bike transit proximity limits used by UI and analysis assumptions. */

export const TRANSIT_THRESHOLD_MIN_M = 100;
/** Typical 15-minute walk (~1.2 km) — recommended max for walk-based filters. */
export const TRANSIT_WALK_MAX_M = 1200;
/** Upper bike-access distance; values above walk max are clamped here in the UI. */
export const TRANSIT_BIKE_MAX_M = 2000;
export const TRANSIT_THRESHOLD_ABSOLUTE_MAX_M = 50_000;

export type TransitThresholdNormalization = {
  meters: number;
  adjusted: boolean;
  warning?: string;
};

export function normalizeTransitThresholdMeters(raw: number): TransitThresholdNormalization {
  if (!Number.isFinite(raw)) {
    return {
      meters: 800,
      adjusted: true,
      warning: "Enter a valid distance in meters.",
    };
  }
  const rounded = Math.round(raw);
  if (rounded < TRANSIT_THRESHOLD_MIN_M) {
    return {
      meters: TRANSIT_THRESHOLD_MIN_M,
      adjusted: true,
      warning: `Minimum transit proximity is ${TRANSIT_THRESHOLD_MIN_M}m.`,
    };
  }
  if (rounded > TRANSIT_BIKE_MAX_M) {
    return {
      meters: TRANSIT_BIKE_MAX_M,
      adjusted: true,
      warning: `Clamped to ${TRANSIT_BIKE_MAX_M}m (bike-access limit). Walk-based analysis typically uses ≤ ${TRANSIT_WALK_MAX_M}m.`,
    };
  }
  if (rounded > TRANSIT_WALK_MAX_M) {
    return {
      meters: rounded,
      adjusted: false,
      warning: `${rounded}m exceeds walk distance (${TRANSIT_WALK_MAX_M}m) — treating as bike-access range.`,
    };
  }
  return { meters: rounded, adjusted: false };
}
