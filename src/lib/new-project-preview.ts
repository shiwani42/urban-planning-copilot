import { assessObjectiveQuality } from "@/lib/domain/objective";

export type NewProjectExample = {
  id: string;
  title: string;
  text: string;
  highlight?: "housing" | "transit" | "schools" | "climate";
};

export const NEW_PROJECT_EXAMPLES: NewProjectExample[] = [
  {
    id: "housing",
    title: "Housing growth",
    text: "Identify areas capable of accommodating 2,000 additional homes while maximizing transit access and avoiding flood-risk areas.",
    highlight: "housing",
  },
  {
    id: "transit",
    title: "Transit",
    text: "Which neighborhoods have the largest transit accessibility gaps and where could a new stop improve access?",
    highlight: "transit",
  },
  {
    id: "schools",
    title: "Schools",
    text: "Identify neighborhoods where a new school would most improve accessibility while avoiding areas already adequately served.",
    highlight: "schools",
  },
  {
    id: "climate",
    title: "Climate resilience",
    text: "Which areas are most exposed to future flood risk and should be excluded from development scenarios?",
    highlight: "climate",
  },
];

export type NewProjectAnalysisStep = {
  label: string;
  detail: string;
};

export type NewProjectPreview = {
  objectiveLine: string;
  geography: string;
  datasets: string[];
  analyses: NewProjectAnalysisStep[];
  confidence: "empty" | "low" | "ready";
  parsing: boolean;
};

const DEFAULT_GEOGRAPHY = "San Francisco — Mission & SoMa demo area (open data snapshot)";

export function buildNewProjectPreview(objective: string): NewProjectPreview {
  const trimmed = objective.trim();
  if (!trimmed) {
    return {
      objectiveLine: "Enter a planning question to preview the plan.",
      geography: DEFAULT_GEOGRAPHY,
      datasets: [],
      analyses: [],
      confidence: "empty",
      parsing: false,
    };
  }

  const quality = assessObjectiveQuality(trimmed);
  const lower = trimmed.toLowerCase();
  const datasets = new Set<string>(["Parcels", "Zoning"]);
  const analyses: NewProjectAnalysisStep[] = [
    { label: "Candidate filtering", detail: "Apply constraints and eligibility rules to parcel inventory." },
    { label: "Ranking", detail: "Score remaining sites against scenario weights." },
  ];

  if (/transit|station|bus|rail|access/.test(lower)) {
    datasets.add("Transit");
    analyses.push({
      label: "Transit proximity",
      detail: "Measure walk access to stops and lines.",
    });
  }
  if (/flood|climate|resilien/.test(lower)) {
    datasets.add("Flood risk");
    analyses.push({
      label: "Flood exclusion",
      detail: "Remove parcels intersecting high-risk zones.",
    });
  }
  if (/home|housing|unit|dwell/.test(lower)) {
    analyses.push({
      label: "Capacity estimation",
      detail: "Estimate theoretical units from zoning envelopes.",
    });
  }
  if (/shelter|population|coverage/.test(lower)) {
    datasets.add("Population");
    analyses.push({
      label: "Coverage / accessibility",
      detail: "Evaluate service reach for vulnerable populations.",
    });
  }
  if (/school/.test(lower)) {
    datasets.add("Schools");
    analyses.push({
      label: "School access gap",
      detail: "Compare enrollment catchments to demand.",
    });
  }

  const objectiveLine =
    trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;

  return {
    objectiveLine,
    geography: DEFAULT_GEOGRAPHY,
    datasets: [...datasets],
    analyses,
    confidence: quality.interpretable ? "ready" : "low",
    parsing: trimmed.length > 5 && !quality.interpretable,
  };
}
