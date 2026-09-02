import type { Candidate, PlanningIntent, MetricValue } from "./types";
import { isAccessIntent, isHousingIntent, intentUsesParkMetrics, intentUsesSchoolMetrics } from "./intent";

export type ResultsColumn = {
  key: string;
  label: string;
  format: (c: Candidate) => string;
};

export function resultsColumnsForIntent(
  intent: PlanningIntent,
  hasParks: boolean
): ResultsColumn[] {
  const base: ResultsColumn[] = [
    { key: "rank", label: "Rank", format: (c: Candidate) => String(c.rank) },
    { key: "label", label: "Candidate", format: (c: Candidate) => c.label },
    { key: "score", label: "Score", format: (c: Candidate) => c.score.toFixed(1) },
  ];

  if (isHousingIntent(intent)) {
    return [
      ...base,
      {
        key: "capacity",
        label: "Capacity",
        format: (c: Candidate) =>
          String(c.metrics.find((m) => m.key === "capacity")?.value ?? "—"),
      },
      {
        key: "transit",
        label: "Transit (m)",
        format: (c: Candidate) =>
          String(c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? "—"),
      },
      { key: "status", label: "Status", format: (c: Candidate) => c.status },
    ];
  }

  if (isAccessIntent(intent)) {
    const cols: ResultsColumn[] = [...base];
    if (intentUsesSchoolMetrics(intent)) {
      cols.push(
        {
          key: "school_gap",
          label: "School gap (people)",
          format: (c: Candidate) =>
            String(
              c.metrics.find((m) => m.key === "school_underserved_pop")?.value ?? "—"
            ),
        },
        {
          key: "school_dist",
          label: "School (m)",
          format: (c: Candidate) =>
            String(c.metrics.find((m) => m.key === "school_distance_m")?.value ?? "—"),
        }
      );
    }
    if (intentUsesParkMetrics(intent) && hasParks) {
      cols.push(
        {
          key: "park_gap",
          label: "Park gap (people)",
          format: (c: Candidate) =>
            String(c.metrics.find((m) => m.key === "park_underserved_pop")?.value ?? "—"),
        },
        {
          key: "park_dist",
          label: "Park (m)",
          format: (c: Candidate) =>
            String(c.metrics.find((m) => m.key === "park_distance_m")?.value ?? "—"),
        }
      );
    }
    if (intent === "transit_gap") {
      cols.push(
        {
          key: "transit_gap",
          label: "Transit gap (people)",
          format: (c: Candidate) =>
            String(
              c.metrics.find((m) => m.key === "transit_underserved_pop")?.value ?? "—"
            ),
        },
        {
          key: "transit_dist",
          label: "Transit (m)",
          format: (c: Candidate) =>
            String(c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? "—"),
        }
      );
    }
    cols.push({ key: "status", label: "Status", format: (c: Candidate) => c.status });
    return cols;
  }

  return [
    ...base,
    {
      key: "transit",
      label: "Transit (m)",
      format: (c: Candidate) =>
        String(c.metrics.find((m) => m.key === "transit_distance_m")?.value ?? "—"),
    },
    { key: "status", label: "Status", format: (c: Candidate) => c.status },
  ];
}

export function housingGoalSummary(input: {
  target?: number;
  totalCapacity?: number;
  targetGapMetric?: { value: number; method?: string; unit?: string };
}): string | null {
  const { target, totalCapacity, targetGapMetric } = input;
  if (target == null || totalCapacity == null) return null;
  const gap = target - totalCapacity;
  if (gap <= 0) {
    return `Estimated ${totalCapacity.toLocaleString()} homes — meets ${target.toLocaleString()}-home target.`;
  }
  const gapNote = targetGapMetric
    ? ` (${targetGapMetric.method ?? "aggregate shortfall"})`
    : "";
  return `Estimated ${totalCapacity.toLocaleString()} homes — ${gap.toLocaleString()} short of ${target.toLocaleString()}-home target${gapNote}.`;
}

export function headlineMetric(
  intent: PlanningIntent,
  aggregateMetrics: MetricValue[]
): { label: string; value: string } | null {
  if (isHousingIntent(intent)) {
    const cap = aggregateMetrics.find((m) => m.key === "total_capacity");
    if (!cap) return null;
    return {
      label: cap.label,
      value: `${cap.value.toLocaleString()}${cap.unit ? ` ${cap.unit}` : ""}`,
    };
  }
  if (intentUsesSchoolMetrics(intent)) {
    const gap = aggregateMetrics.find((m) => m.key === "total_school_underserved_pop");
    if (gap) {
      return {
        label: gap.label,
        value: `${gap.value.toLocaleString()}${gap.unit ? ` ${gap.unit}` : ""}`,
      };
    }
  }
  if (intentUsesParkMetrics(intent)) {
    const gap = aggregateMetrics.find((m) => m.key === "total_park_underserved_pop");
    if (gap) {
      return {
        label: gap.label,
        value: `${gap.value.toLocaleString()}${gap.unit ? ` ${gap.unit}` : ""}`,
      };
    }
  }
  const areas = aggregateMetrics.find((m) => m.key === "gap_area_count");
  if (areas) {
    return { label: areas.label, value: String(areas.value) };
  }
  return null;
}

export function evidenceMetricsForCandidate(
  candidate: Candidate,
  intent: PlanningIntent
): MetricValue[] {
  const keys = new Set<string>();
  if (isHousingIntent(intent)) {
    ["capacity", "transit_distance_m", "transit_score", "flood_resilience", "housing_target_gap"].forEach(
      (k) => keys.add(k)
    );
  } else if (isAccessIntent(intent)) {
    if (intentUsesSchoolMetrics(intent)) {
      ["school_distance_m", "school_underserved_pop", "school_gap_score"].forEach((k) =>
        keys.add(k)
      );
    }
    if (intentUsesParkMetrics(intent)) {
      ["park_distance_m", "park_underserved_pop", "park_gap_score"].forEach((k) => keys.add(k));
    }
    if (intent === "transit_gap") {
      ["transit_distance_m", "transit_underserved_pop", "transit_gap_score"].forEach((k) =>
        keys.add(k)
      );
    }
    if (intent === "emergency_shelter") {
      keys.add("population_coverage");
    }
  }
  const ordered = candidate.metrics.filter((m) => keys.has(m.key));
  return ordered.length ? ordered : candidate.metrics.slice(0, 6);
}
