import type {
  Candidate,
  Constraint,
  CriterionWeight,
  MetricValue,
  PlanningIntent,
  PlanningObjective,
} from "./types";
import {
  assessObjectiveQuality,
  detectIntent,
  parseObjective,
  defaultWeightsForIntent,
} from "./objective";
import { runSpatialAnalysis } from "./spatial";

export type ExploreAnalysisType =
  | "transit_gap"
  | "school_gap"
  | "flood_exposure"
  | "housing_siting"
  | "emergency_shelter"
  | "unsupported";

const UNSUPPORTED_TOPIC_RE =
  /\b(parking|tax\s+rate|budget|election|variance\s+appeal|curb\s+cut|signage)\b/i;

const EXPLORE_SUPPORTED_INTENTS = new Set<PlanningIntent>([
  "transit_gap",
  "school_accessibility",
  "housing_capacity",
  "emergency_shelter",
  "explore",
]);

export function assessExploreQuestion(text: string): {
  interpretable: boolean;
  supported: boolean;
  warning?: string;
  analysisType: ExploreAnalysisType;
} {
  const quality = assessObjectiveQuality(text);
  if (!quality.interpretable) {
    return {
      interpretable: false,
      supported: false,
      warning: quality.warning,
      analysisType: "unsupported",
    };
  }

  if (UNSUPPORTED_TOPIC_RE.test(text)) {
    return {
      interpretable: true,
      supported: false,
      warning:
        "This question is outside supported spatial investigations (transit gaps, school access, flood exposure, housing siting). Rephrase as a location-based planning question.",
      analysisType: "unsupported",
    };
  }

  const intent = detectIntent(text);
  const analysisType = exploreAnalysisTypeForIntent(intent, text);

  if (intent === "climate_resilience") {
    return {
      interpretable: true,
      supported: false,
      warning: "Climate resilience analysis is not yet supported in Explore.",
      analysisType: "unsupported",
    };
  }

  if (intent === "generic_siting" && analysisType === "unsupported") {
    return {
      interpretable: true,
      supported: false,
      warning:
        "Could not map this question to a supported spatial investigation. Try transit gaps, school access, flood exposure, or housing siting.",
      analysisType: "unsupported",
    };
  }

  if (!EXPLORE_SUPPORTED_INTENTS.has(intent) && analysisType === "unsupported") {
    return {
      interpretable: true,
      supported: false,
      warning:
        "This question does not match a supported Explore analysis type. Try rephrasing with spatial planning terms.",
      analysisType: "unsupported",
    };
  }

  return { interpretable: true, supported: true, analysisType };
}

export function exploreAnalysisTypeForIntent(
  intent: PlanningIntent,
  text: string
): ExploreAnalysisType {
  if (intent === "transit_gap") return "transit_gap";
  if (intent === "school_accessibility") return "school_gap";
  if (intent === "emergency_shelter") return "emergency_shelter";
  if (intent === "housing_capacity") return "housing_siting";
  if (/flood|floodplain|inundation/i.test(text) && !/home|housing|unit/i.test(text)) {
    return "flood_exposure";
  }
  if (intent === "explore" && /flood/i.test(text)) return "flood_exposure";
  if (intent === "explore" && /transit|station|bus|rail/i.test(text)) return "transit_gap";
  if (intent === "explore" && /school|education/i.test(text)) return "school_gap";
  if (intent === "explore" && /home|housing|unit|capacity/i.test(text)) return "housing_siting";
  if (intent === "generic_siting") return "unsupported";
  return "housing_siting";
}

function dedupeLimitations(notes: string[]): string[] {
  const seen = new Set<string>();
  return notes.filter((note) => {
    const key = note.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function formatDatasetLimitations(
  datasets: Array<{ name: string; limitations: string[]; incompleteCoverage?: boolean }>
): string[] {
  const out: string[] = [];
  for (const d of datasets) {
    for (const l of d.limitations) {
      const prefixed = l.startsWith(d.name) ? l : `${d.name}: ${l}`;
      out.push(prefixed);
    }
  }
  return dedupeLimitations(out);
}

function constraintsForExplore(
  analysisType: ExploreAnalysisType,
  constraints: Constraint[]
): Constraint[] {
  switch (analysisType) {
    case "transit_gap":
    case "school_gap":
      // Gap investigations score all parcels — no siting filters.
      return constraints.filter(
        (c) =>
          c.operator !== "within_distance" &&
          c.attribute !== "zoning" &&
          !(c.datasetKind === "flood" && c.operator === "not_intersects")
      );
    case "flood_exposure":
      return constraints.filter(
        (c) => c.operator !== "within_distance" && c.attribute !== "zoning"
      );
    default:
      return constraints;
  }
}

function weightsForExplore(
  analysisType: ExploreAnalysisType,
  intent: PlanningIntent
): CriterionWeight[] {
  if (analysisType === "transit_gap") {
    return defaultWeightsForIntent("transit_gap");
  }
  if (analysisType === "school_gap") {
    return defaultWeightsForIntent("school_accessibility");
  }
  if (analysisType === "flood_exposure") {
    return [
      { id: "flood", key: "flood_exposure", label: "Flood exposure severity", weight: 0.6 },
      { id: "pop", key: "population_coverage", label: "Population affected", weight: 0.25 },
      { id: "res", key: "flood_resilience", label: "Residual resilience", weight: 0.15 },
    ];
  }
  return defaultWeightsForIntent(intent);
}

function gapSummary(
  analysisType: ExploreAnalysisType,
  candidates: Candidate[],
  aggregateMetrics: MetricValue[]
): string {
  if (!candidates.length) {
    return "No areas matched this gap investigation.";
  }
  const top = candidates[0];
  const get = (key: string) => aggregateMetrics.find((m) => m.key === key)?.value ?? 0;

  if (analysisType === "transit_gap") {
    const dist = top.metrics.find((m) => m.key === "transit_distance_m")?.value ?? 0;
    const pop = top.metrics.find((m) => m.key === "population_coverage")?.value ?? 0;
    return `Identified ${get("gap_area_count")} areas with transit accessibility gaps (median ${get("median_gap_distance_m")} m from nearest transit). Largest gap: ${top.label} (${dist} m), affecting ~${pop.toLocaleString()} people nearby.`;
  }

  if (analysisType === "school_gap") {
    const dist = top.metrics.find((m) => m.key === "school_distance_m")?.value ?? 0;
    const pop = top.metrics.find((m) => m.key === "population_coverage")?.value ?? 0;
    return `Identified ${get("gap_area_count")} areas underserved by schools (median ${get("median_gap_distance_m")} m to nearest school). Worst access: ${top.label} (${dist} m), ~${pop.toLocaleString()} people in catchment.`;
  }

  if (analysisType === "flood_exposure") {
    const exposure = top.metrics.find((m) => m.key === "flood_exposure_score")?.value ?? 0;
    return `Mapped ${get("gap_area_count")} areas by flood exposure. Highest exposure: ${top.label} (score ${exposure}).`;
  }

  return `Found ${candidates.length} areas for investigation. Top area: ${top.label} (score ${top.score}).`;
}

export interface ExploreInvestigationInput {
  question: string;
  layers: Record<string, GeoJSON.FeatureCollection>;
  datasetIds: Record<string, string>;
  datasets: Array<{
    id: string;
    name: string;
    kind: string;
    limitations: string[];
    incompleteCoverage?: boolean;
    enabled: boolean;
  }>;
}

export interface ExploreMethodology {
  analysisType: ExploreAnalysisType;
  steps: string[];
  weights: Array<{ key: string; label: string; weight: number }>;
  datasets: string[];
  sortKey: string;
}

export interface ExploreCandidateRow {
  id: string;
  label: string;
  rank: number;
  score: number;
  metrics: MetricValue[];
}

export interface ExploreInvestigationResult {
  question: string;
  investigatedAt: string;
  analysisType: ExploreAnalysisType;
  supported: boolean;
  unsupportedReason?: string;
  objective: PlanningObjective;
  constraints: Constraint[];
  weights: CriterionWeight[];
  summary: string;
  limitations: string[];
  methodology: ExploreMethodology;
  /** Top page with full geometry for map interaction. */
  candidates: Candidate[];
  /** All ranked rows (no geometry) for paginated tables. */
  candidateRows: ExploreCandidateRow[];
  aggregateMetrics: MetricValue[];
  totalCandidates: number;
  displayedCount: number;
  stepLogs: Array<{ step: string; detail: string; count?: number }>;
}

const DISPLAY_LIMIT = 15;

export function runExploreInvestigation(
  input: ExploreInvestigationInput
): ExploreInvestigationResult {
  const assessed = assessExploreQuestion(input.question);
  const investigatedAt = new Date().toISOString();

  if (!assessed.interpretable || !assessed.supported) {
    throw new Error(
      assessed.warning ?? "Question is not supported for spatial investigation."
    );
  }

  const parsed = parseObjective(input.question, "Study area");
  const analysisType = assessed.analysisType;
  const exploreConstraints = constraintsForExplore(analysisType, parsed.constraints);
  const exploreWeights = weightsForExplore(analysisType, parsed.objective.intent);

  const objective: PlanningObjective = {
    ...parsed.objective,
    intent:
      analysisType === "transit_gap"
        ? "transit_gap"
        : analysisType === "school_gap"
          ? "school_accessibility"
          : parsed.objective.intent,
  };

  const datasetLimitations = formatDatasetLimitations(
    input.datasets.filter((d) => d.enabled && (d.incompleteCoverage || d.limitations.length))
  );

  const output = runSpatialAnalysis({
    objective,
    constraints: exploreConstraints,
    weights: exploreWeights,
    assumptions: parsed.assumptions,
    selections: [],
    layers: input.layers,
    datasetIds: input.datasetIds,
    externalLimitations: datasetLimitations,
    exploreProfile: analysisType,
  });

  let limitations = dedupeLimitations(output.limitations);

  const uplandTop = output.candidates
    .slice(0, 5)
    .some((c) => /upland/i.test(c.label));
  const incompleteFlood = limitations.some((l) =>
    /incomplete flood mapping/i.test(l)
  );
  if (uplandTop && incompleteFlood) {
    limitations.push(
      "Top gap areas include eastern uplands where flood mapping is incomplete — interpret exposure alongside gap rankings."
    );
    limitations = dedupeLimitations(limitations);
  }

  const summary =
    analysisType === "transit_gap" ||
    analysisType === "school_gap" ||
    analysisType === "flood_exposure"
      ? gapSummary(analysisType, output.candidates, output.aggregateMetrics)
      : output.summary;

  const methodology: ExploreMethodology = {
    analysisType,
    steps: output.stepLogs.map((s) => s.detail),
    weights: exploreWeights.map((w) => ({
      key: w.key,
      label: w.label,
      weight: w.weight,
    })),
    datasets: input.datasets.filter((d) => d.enabled).map((d) => d.name),
    sortKey:
      analysisType === "school_gap"
        ? "school_gap_score"
        : analysisType === "transit_gap"
          ? "transit_gap_score"
          : analysisType === "flood_exposure"
            ? "flood_exposure_score"
            : "composite_score",
  };

  const displayed = output.candidates.slice(0, DISPLAY_LIMIT);
  const candidateRows: ExploreCandidateRow[] = output.candidates.map((c) => ({
    id: c.id,
    label: c.label,
    rank: c.rank,
    score: c.score,
    metrics: c.metrics,
  }));

  return {
    question: input.question,
    investigatedAt,
    analysisType,
    supported: true,
    objective,
    constraints: exploreConstraints,
    weights: exploreWeights,
    summary,
    limitations,
    methodology,
    candidates: displayed,
    candidateRows,
    aggregateMetrics: output.aggregateMetrics,
    totalCandidates: output.candidates.length,
    displayedCount: displayed.length,
    stepLogs: output.stepLogs,
  };
}

/** Session payload for convert-to-project handoff (no project created until /new confirm). */
export const EXPLORE_CONVERT_KEY = "upc-explore-convert-draft";
export const EXPLORE_SESSION_KEY = "upc-explore-session";

export interface ExploreConvertDraft {
  objective: string;
  suggestedName: string;
  investigatedAt: string;
  analysisType: ExploreAnalysisType;
  summary: string;
  limitations: string[];
  totalCandidates: number;
  topCandidates: Array<{
    id: string;
    label: string;
    score: number;
    rank: number;
    metrics: MetricValue[];
  }>;
}

export function buildExploreConvertDraft(
  result: ExploreInvestigationResult
): ExploreConvertDraft {
  const typeLabel = result.analysisType.replace(/_/g, " ");
  return {
    objective: result.question,
    suggestedName: `Explore — ${typeLabel}`,
    investigatedAt: result.investigatedAt,
    analysisType: result.analysisType,
    summary: result.summary,
    limitations: result.limitations,
    totalCandidates: result.totalCandidates,
    topCandidates: result.candidates.slice(0, 10).map((c) => ({
      id: c.id,
      label: c.label,
      score: c.score,
      rank: c.rank,
      metrics: c.metrics,
    })),
  };
}

/** Objective text for a persisted planning project created from Explore findings. */
export function exploreObjectiveTextForProject(
  draft: ExploreConvertDraft | Pick<ExploreConvertDraft, "objective" | "analysisType" | "summary" | "totalCandidates">
): string {
  const findingsNote = draft.summary
    ? `\n\n--- Scratch findings (${draft.analysisType.replace(/_/g, " ")}, ${draft.totalCandidates} areas) ---\n${draft.summary}`
    : "";
  return draft.objective + findingsNote;
}
