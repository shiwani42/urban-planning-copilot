import { createHash } from "crypto";
import { nanoid } from "nanoid";
import type {
  AnalysisPlan,
  Assumption,
  Constraint,
  CriterionWeight,
  PlanningIntent,
  PlanningObjective,
} from "./types";

const HOUSING_RE =
  /(\d[\d,]*)\s*(?:additional\s+)?(?:homes|housing\s+units|units|dwellings)/i;
const TRANSIT_DIST_RE =
  /(?:within|inside|near|of)\s+(\d[\d,]*)\s*(m|meters|metres|km|kilometers)?(?:\s+of\s+)?(?:transit|station|rail|bus)/i;
const TRANSIT_DIST_ALT_RE =
  /(\d[\d,]*)\s*(m|meters|metres|km)?\s*(?:of\s+)?(?:transit|from\s+transit)/i;
const FLOOD_RE = /flood|flood-risk|floodplain|inundation/i;
const ZONING_RE = /zoning|residential(?:ly)?\s+zon/i;
const SHELTER_RE = /shelter|emergency\s+response|evacuation/i;
const SCHOOL_RE = /school|education|classroom/i;
const TRANSIT_GAP_RE =
  /transit\s+(?:accessibility\s+)?gaps?|underserved.*transit|new\s+transit\s+stop/i;
const CLIMATE_RE = /climate|resilience|heat\s+island|sea\s+level/i;
const COUNT_RE = /(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:locations?|sites?|shelters?|schools?|stops?)/i;

function parseCountToken(raw: string): number | undefined {
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };
  const key = raw.toLowerCase();
  if (key in words) return words[key];
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function parseDistanceMeters(raw: string, unit?: string): number {
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return 800;
  const u = (unit || "m").toLowerCase();
  if (u.startsWith("km")) return n * 1000;
  return n;
}

const PLANNING_SIGNAL_RE =
  /\b(housing|homes?|units?|dwellings?|transit|station|bus|rail|flood|school|shelter|zoning|capacity|neighborhood|development|residential|population|accessibility|parcel|site|area|accommodat|growth|planning|locat)\b/i;

/** Score how interpretable a free-text objective is for planning analysis. */
export function assessObjectiveQuality(text: string): {
  confidence: number;
  warning?: string;
  interpretable: boolean;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      confidence: 0,
      warning: "Enter a planning objective describing what you want to analyze.",
      interpretable: false,
    };
  }
  if (trimmed.length < 8) {
    return {
      confidence: 0.15,
      warning:
        "This objective is too short to interpret. Describe the planning question, target, and constraints.",
      interpretable: false,
    };
  }
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length < 3 && !/\d/.test(trimmed)) {
    return {
      confidence: 0.2,
      warning:
        "This objective does not look like a planning question. Add context such as housing targets, transit, or flood constraints.",
      interpretable: false,
    };
  }
  if (!PLANNING_SIGNAL_RE.test(trimmed) && !/\d/.test(trimmed)) {
    return {
      confidence: 0.2,
      warning:
        "Low confidence — the objective may not be interpretable as a planning analysis. Revise before running analysis.",
      interpretable: false,
    };
  }
  return { confidence: 1, interpretable: true };
}

export function detectIntent(text: string): PlanningIntent {
  if (SHELTER_RE.test(text)) return "emergency_shelter";
  if (SCHOOL_RE.test(text)) return "school_accessibility";
  if (TRANSIT_GAP_RE.test(text)) return "transit_gap";
  if (CLIMATE_RE.test(text) && !HOUSING_RE.test(text)) return "climate_resilience";
  if (HOUSING_RE.test(text) || /housing|homes|residential growth/i.test(text))
    return "housing_capacity";
  if (/explore|where are|largest|discover/i.test(text)) return "explore";
  return "generic_siting";
}

export function defaultWeightsForIntent(intent: PlanningIntent): CriterionWeight[] {
  switch (intent) {
    case "housing_capacity":
      return [
        { id: nanoid(), key: "transit", label: "Transit accessibility", weight: 0.45 },
        { id: nanoid(), key: "capacity", label: "Housing capacity", weight: 0.35 },
        { id: nanoid(), key: "flood_resilience", label: "Flood resilience", weight: 0.2 },
      ];
    case "emergency_shelter":
      return [
        { id: nanoid(), key: "population_coverage", label: "Population coverage", weight: 0.5 },
        { id: nanoid(), key: "accessibility", label: "Accessibility", weight: 0.3 },
        { id: nanoid(), key: "flood_resilience", label: "Flood resilience", weight: 0.2 },
      ];
    case "school_accessibility":
      return [
        { id: nanoid(), key: "accessibility_gain", label: "Accessibility improvement", weight: 0.55 },
        { id: nanoid(), key: "underservice", label: "Underserved population", weight: 0.3 },
        { id: nanoid(), key: "flood_resilience", label: "Flood resilience", weight: 0.15 },
      ];
    case "transit_gap":
      return [
        { id: nanoid(), key: "gap_severity", label: "Accessibility gap", weight: 0.55 },
        { id: nanoid(), key: "population_coverage", label: "Population coverage", weight: 0.3 },
        { id: nanoid(), key: "flood_resilience", label: "Flood resilience", weight: 0.15 },
      ];
    default:
      return [
        { id: nanoid(), key: "accessibility", label: "Accessibility", weight: 0.4 },
        { id: nanoid(), key: "capacity", label: "Capacity / suitability", weight: 0.35 },
        { id: nanoid(), key: "flood_resilience", label: "Flood resilience", weight: 0.25 },
      ];
  }
}

export function defaultAssumptions(intent: PlanningIntent): Assumption[] {
  const common: Assumption[] = [
    {
      id: nanoid(),
      key: "developable_fraction",
      label: "Developable area fraction",
      value: 0.7,
      unit: "ratio",
      description: "Share of parcel area assumed developable after setbacks and open space.",
      editable: true,
    },
    {
      id: nanoid(),
      key: "units_per_hectare",
      label: "Default residential density",
      value: 80,
      unit: "units/ha",
      description: "Fallback density when parcel FAR/density is unavailable.",
      editable: true,
    },
  ];

  if (intent === "housing_capacity") {
    common.push({
      id: nanoid(),
      key: "avg_household_size",
      label: "Average household size",
      value: 2.3,
      unit: "persons",
      description: "Used only for population-derived capacity estimates.",
      editable: true,
    });
  }

  if (intent === "emergency_shelter") {
    common.push({
      id: nanoid(),
      key: "shelter_service_radius_m",
      label: "Shelter service radius",
      value: 1500,
      unit: "m",
      description: "Assumed walking/service catchment for a shelter site.",
      editable: true,
    });
  }

  if (intent === "school_accessibility") {
    common.push({
      id: nanoid(),
      key: "school_service_radius_m",
      label: "School service radius",
      value: 1000,
      unit: "m",
      description: "Distance threshold for adequate school access.",
      editable: true,
    });
  }

  return common;
}

export function parseObjective(
  rawText: string,
  geographyLabel = "Study area"
): {
  objective: PlanningObjective;
  constraints: Constraint[];
  weights: CriterionWeight[];
  assumptions: Assumption[];
} {
  const intent = detectIntent(rawText);
  const requirements: string[] = [];
  const constraints: Constraint[] = [];

  const housing = rawText.match(HOUSING_RE);
  let targetValue: number | undefined;
  let targetUnit: string | undefined;
  if (housing) {
    targetValue = Number(housing[1].replace(/,/g, ""));
    targetUnit = "homes";
    requirements.push(`Housing target: ${targetValue} homes`);
  }

  const countMatch = rawText.match(COUNT_RE);
  if (!targetValue && countMatch) {
    targetValue = parseCountToken(countMatch[1]);
    targetUnit =
      intent === "emergency_shelter"
        ? "shelters"
        : intent === "school_accessibility"
          ? "schools"
          : intent === "transit_gap"
            ? "stops"
            : "sites";
    if (targetValue != null) {
      requirements.push(`Site count target: ${targetValue} ${targetUnit}`);
    }
  }

  let transitMeters: number | undefined;
  const td = rawText.match(TRANSIT_DIST_RE) || rawText.match(TRANSIT_DIST_ALT_RE);
  if (td) {
    transitMeters = parseDistanceMeters(td[1], td[2]);
    requirements.push(`Transit proximity ≤ ${transitMeters}m`);
    constraints.push({
      id: nanoid(),
      label: `Within ${transitMeters}m of transit`,
      datasetKind: "transit",
      operator: "within_distance",
      value: transitMeters,
      hard: true,
      enabled: true,
    });
  } else if (/transit/i.test(rawText) && intent === "housing_capacity") {
    transitMeters = 800;
    requirements.push("Maximize transit accessibility (default 800m filter)");
    constraints.push({
      id: nanoid(),
      label: "Within 800m of transit",
      datasetKind: "transit",
      operator: "within_distance",
      value: 800,
      hard: true,
      enabled: true,
    });
  }

  if (FLOOD_RE.test(rawText) || /avoiding flood|outside.*flood/i.test(rawText)) {
    requirements.push("Exclude high-risk flood areas");
    constraints.push({
      id: nanoid(),
      label: "Outside high-risk flood zones",
      datasetKind: "flood",
      operator: "not_intersects",
      value: "high",
      hard: true,
      enabled: true,
    });
  }

  if (ZONING_RE.test(rawText) || intent === "housing_capacity") {
    requirements.push("Respect residential zoning compatibility");
    constraints.push({
      id: nanoid(),
      label: "Residential zoning compatible",
      datasetKind: "parcels",
      attribute: "zoning",
      operator: "in",
      value: ["R1", "R2", "R3", "MX", "MU"],
      hard: true,
      enabled: true,
    });
  }

  if (intent === "emergency_shelter") {
    requirements.push("Maximize population coverage");
    requirements.push("Prioritize accessibility");
    if (!constraints.some((c) => c.datasetKind === "flood")) {
      constraints.push({
        id: nanoid(),
        label: "Outside high-risk flood zones",
        datasetKind: "flood",
        operator: "not_intersects",
        value: "high",
        hard: true,
        enabled: true,
      });
    }
  }

  if (intent === "school_accessibility") {
    requirements.push("Improve school accessibility for underserved areas");
    requirements.push("Avoid areas already adequately served");
  }

  if (intent === "transit_gap") {
    requirements.push("Identify neighborhoods with largest transit accessibility gaps");
  }

  const quality = assessObjectiveQuality(rawText);
  const baseConfidence = requirements.length >= 2 ? 0.85 : requirements.length === 1 ? 0.65 : 0.45;
  const objective: PlanningObjective = {
    rawText,
    intent,
    targetValue,
    targetUnit,
    geographyLabel,
    parsedRequirements: requirements,
    confidence: quality.interpretable
      ? Math.min(baseConfidence, quality.confidence === 1 ? baseConfidence : quality.confidence)
      : quality.confidence,
    qualityWarning: quality.warning,
  };

  return {
    objective,
    constraints,
    weights: defaultWeightsForIntent(intent),
    assumptions: defaultAssumptions(intent),
  };
}

export function buildAnalysisPlan(
  objective: PlanningObjective,
  constraints: Constraint[],
  datasetNames: Record<string, string>
): AnalysisPlan {
  const steps = [];
  let order = 1;

  const zoning = constraints.find(
    (c) => c.attribute === "zoning" || /zoning/i.test(c.label)
  );
  if (zoning?.enabled) {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "filter_attribute",
      label: "Identify compatible parcels / candidate sites",
      purpose: "Apply zoning or land-use compatibility filters",
      datasets: [datasetNames.parcels || "parcels"].filter(Boolean),
      assumptions: [],
      status: "pending" as const,
    });
  } else {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "load_candidates",
      label: "Load candidate geography",
      purpose: "Establish the candidate feature set for analysis",
      datasets: [datasetNames.parcels || "parcels"],
      assumptions: [],
      status: "pending" as const,
    });
  }

  if (constraints.some((c) => c.operator === "not_intersects" && c.enabled)) {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "exclude_flood",
      label: "Remove high-risk flood areas",
      purpose: "Hard-exclude candidates intersecting high flood risk",
      datasets: [datasetNames.flood || "flood"],
      assumptions: [],
      status: "pending" as const,
    });
  }

  if (constraints.some((c) => c.operator === "within_distance" && c.enabled)) {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "transit_proximity",
      label: "Calculate distance to transit",
      purpose: "Measure and filter by transit proximity threshold",
      datasets: [datasetNames.transit || "transit"],
      assumptions: [],
      status: "pending" as const,
    });
  } else if (
    objective.intent === "transit_gap" ||
    objective.intent === "school_accessibility" ||
    objective.intent === "emergency_shelter"
  ) {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "accessibility",
      label: "Calculate accessibility metrics",
      purpose: "Score candidates by proximity to relevant services",
      datasets: [
        datasetNames.transit || "transit",
        datasetNames.population || "population",
        datasetNames.schools || "schools",
      ].filter(Boolean),
      assumptions: [],
      status: "pending" as const,
    });
  }

  if (objective.intent === "housing_capacity") {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "estimate_capacity",
      label: "Estimate housing capacity",
      purpose: "Convert developable area and density assumptions into unit capacity",
      datasets: [datasetNames.parcels || "parcels"],
      assumptions: ["developable_fraction", "units_per_hectare"],
      status: "pending" as const,
    });
  } else if (objective.intent === "emergency_shelter") {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "population_coverage",
      label: "Estimate population coverage",
      purpose: "Score how many people each candidate can cover within service radius",
      datasets: [datasetNames.population || "population"],
      assumptions: ["shelter_service_radius_m"],
      status: "pending" as const,
    });
  } else if (objective.intent === "school_accessibility") {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "school_gap",
      label: "Identify school accessibility gaps",
      purpose: "Find areas poorly served by existing schools",
      datasets: [
        datasetNames.schools || "schools",
        datasetNames.population || "population",
      ],
      assumptions: ["school_service_radius_m"],
      status: "pending" as const,
    });
  } else if (objective.intent === "transit_gap") {
    steps.push({
      id: nanoid(),
      order: order++,
      operation: "transit_gap",
      label: "Identify transit accessibility gaps",
      purpose: "Find neighborhoods farthest from existing transit",
      datasets: [
        datasetNames.transit || "transit",
        datasetNames.population || "population",
      ],
      assumptions: [],
      status: "pending" as const,
    });
  }

  steps.push({
    id: nanoid(),
    order: order++,
    operation: "apply_exclusions",
    label: "Apply human geographic exclusions",
    purpose: "Honor planner-drawn exclusion/inclusion areas",
    datasets: [],
    assumptions: [],
    status: "pending" as const,
  });

  steps.push({
    id: nanoid(),
    order: order++,
    operation: "rank_candidates",
    label:
      objective.intent === "emergency_shelter" && objective.targetValue
        ? `Rank and select top ${objective.targetValue} sites`
        : "Rank candidate areas",
    purpose: "Apply weighted criteria to produce an ordered recommendation set",
    datasets: [],
    assumptions: [],
    status: "pending" as const,
  });

  return {
    id: nanoid(),
    summary: `Analysis plan for ${objective.intent.replace(/_/g, " ")} objective`,
    steps,
    datasets: Array.from(new Set(steps.flatMap((s) => s.datasets))),
    constraints: constraints.filter((c) => c.enabled).map((c) => c.label),
    assumptions: steps.flatMap((s) => s.assumptions),
    createdAt: new Date().toISOString(),
  };
}

export function normalizeWeights(weights: CriterionWeight[]): CriterionWeight[] {
  const sum = weights.reduce((a, w) => a + w.weight, 0);
  if (sum <= 0) {
    const even = 1 / Math.max(weights.length, 1);
    return weights.map((w) => ({ ...w, weight: even }));
  }
  return weights.map((w) => ({ ...w, weight: w.weight / sum }));
}

export function hashConfig(parts: unknown): string {
  const json = JSON.stringify(parts);
  // Deterministic, environment-agnostic short hash (not cryptographic).
  let h = 2166136261;
  for (let i = 0; i < json.length; i++) {
    h ^= json.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + json.length.toString(16);
}

/** SHA-256 receipt for auditable human-approved operations. */
export function sha256Receipt(data: unknown): string {
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
