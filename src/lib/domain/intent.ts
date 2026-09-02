import type { PlanningIntent } from "./types";

/** Planning intents that estimate housing units / density. */
export const HOUSING_INTENTS: PlanningIntent[] = ["housing_capacity"];

/** Intents focused on service accessibility gaps (not housing production). */
export const ACCESS_INTENTS: PlanningIntent[] = [
  "school_accessibility",
  "park_accessibility",
  "service_access",
  "transit_gap",
  "emergency_shelter",
];

export function isHousingIntent(intent: PlanningIntent): boolean {
  return HOUSING_INTENTS.includes(intent);
}

export function isAccessIntent(intent: PlanningIntent): boolean {
  return ACCESS_INTENTS.includes(intent);
}

export function intentUsesSchoolMetrics(intent: PlanningIntent): boolean {
  return intent === "school_accessibility" || intent === "service_access";
}

export function intentUsesParkMetrics(intent: PlanningIntent): boolean {
  return intent === "park_accessibility" || intent === "service_access";
}

export function intentLabel(intent: PlanningIntent): string {
  return intent.replace(/_/g, " ");
}
