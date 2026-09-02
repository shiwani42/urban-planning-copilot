import type {
  Assumption,
  Constraint,
  CriterionWeight,
  PlanningObjective,
} from "./types";
import type { ScenarioComparisonInput } from "./spatial";
import { compareScenarioMetrics } from "./spatial";
import { isHousingIntent } from "./intent";

export const RANK_SCORE_EXPLANATION =
  "Rank score is a weighted sum of the priority factors listed in each scenario's inputs (transit, capacity, flood resilience, etc.). Scores are only comparable within a single scenario — use ranking shifts and capacity metrics across scenarios.";

export const IDENTICAL_INPUTS_MESSAGE =
  "These scenarios use the same weights and constraints — results will match until you change one.";

export type ScenarioInputSnapshot = {
  scenarioId: string;
  name: string;
  weights: CriterionWeight[];
  constraints: Constraint[];
  assumptions: Assumption[];
  objective: PlanningObjective;
};

export type InputsDiffSection = {
  heading: "Weights" | "Constraints" | "Assumptions";
  identical: boolean;
  lines: string[];
};

export type ScenarioInputsDiff = {
  allIdentical: boolean;
  identicalMessage: string | null;
  sections: InputsDiffSection[];
};

export type HousingTargetProgress = {
  target: number;
  units: number;
  percentOfTarget: number;
  gap: number;
  singleParcelMeets: boolean;
  shortlistMeets: boolean;
  shortlistCapacity: number;
  summary: string;
};

export type CompareMetricDef = {
  key: string;
  label: string;
  numeric: boolean;
};

/** Metrics shown in the compare table (weights moved to inputs diff). */
export const COMPARE_METRIC_DEFS: CompareMetricDef[] = [
  { key: "eligible_count", label: "Eligible areas", numeric: true },
  { key: "total_capacity", label: "Est. housing capacity", numeric: true },
  { key: "housing_target_pct", label: "Housing target progress", numeric: true },
  { key: "housing_target_gap", label: "Target gap (homes)", numeric: true },
  { key: "meets_target_count", label: "Parcels meeting target alone", numeric: true },
  { key: "shortlist_meets_target", label: "Shortlist meets target", numeric: false },
  { key: "shortlist_capacity", label: "Shortlist combined capacity", numeric: true },
  { key: "avg_transit_distance", label: "Avg transit distance (m)", numeric: true },
  { key: "avg_flood_resilience", label: "Avg flood resilience score", numeric: true },
  { key: "top_candidate", label: "Top candidate", numeric: false },
  { key: "top_candidate_capacity", label: "Top candidate capacity", numeric: true },
  { key: "top_rank_score", label: "Top rank score (scenario-local)", numeric: true },
  { key: "top_3", label: "Top 3 candidates", numeric: false },
];

function weightFingerprint(weights: CriterionWeight[]): string {
  return [...weights]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((w) => `${w.key}:${Math.round(w.weight * 1000)}`)
    .join("|");
}

function constraintFingerprint(constraints: Constraint[]): string {
  return constraints
    .filter((c) => c.enabled)
    .map((c) => `${c.datasetKind ?? ""}:${c.operator}:${c.value}:${c.label}`)
    .sort()
    .join("|");
}

function assumptionFingerprint(assumptions: Assumption[]): string {
  return assumptions
    .map((a) => `${a.label}:${a.value}${a.unit ? ` ${a.unit}` : ""}`)
    .sort()
    .join("|");
}

function formatWeightLine(w: CriterionWeight): string {
  return `${w.label}: ${Math.round(w.weight * 100)}%`;
}

function formatConstraintLine(c: Constraint): string {
  const hard = c.hard ? "hard" : "soft";
  const value =
    c.operator === "within_distance" && typeof c.value === "number"
      ? `${c.value}m`
      : String(c.value ?? "");
  return `${c.label} (${hard}${value ? `, ${value}` : ""})`;
}

function formatAssumptionLine(a: Assumption): string {
  return `${a.label}: ${a.value}${a.unit ? ` ${a.unit}` : ""}`;
}

export function buildScenarioInputsDiff(
  snapshots: ScenarioInputSnapshot[]
): ScenarioInputsDiff {
  if (snapshots.length < 2) {
    return { allIdentical: true, identicalMessage: null, sections: [] };
  }

  const weightPrints = snapshots.map((s) => weightFingerprint(s.weights));
  const constraintPrints = snapshots.map((s) => constraintFingerprint(s.constraints));
  const assumptionPrints = snapshots.map((s) => assumptionFingerprint(s.assumptions));

  const weightsIdentical = weightPrints.every((p) => p === weightPrints[0]);
  const constraintsIdentical = constraintPrints.every((p) => p === constraintPrints[0]);
  const assumptionsIdentical = assumptionPrints.every((p) => p === assumptionPrints[0]);

  const sections: InputsDiffSection[] = [];

  if (weightsIdentical) {
    sections.push({
      heading: "Weights",
      identical: true,
      lines: snapshots[0].weights.map(formatWeightLine),
    });
  } else if (snapshots.length === 2) {
    const [a, b] = snapshots;
    const byKey = new Map(a.weights.map((w) => [w.key, w]));
    const lines: string[] = [];
    for (const wb of b.weights) {
      const wa = byKey.get(wb.key);
      const pctA = Math.round((wa?.weight ?? 0) * 100);
      const pctB = Math.round(wb.weight * 100);
      if (pctA !== pctB) {
        lines.push(`${wb.label}: ${pctA}% → ${pctB}%`);
      }
    }
    sections.push({
      heading: "Weights",
      identical: false,
      lines: lines.length ? lines : ["Priority weights differ between scenarios."],
    });
  } else {
    sections.push({
      heading: "Weights",
      identical: false,
      lines: snapshots.map((s) => `${s.name}: ${s.weights.map(formatWeightLine).join(" · ")}`),
    });
  }

  if (constraintsIdentical) {
    const enabled = snapshots[0].constraints.filter((c) => c.enabled);
    sections.push({
      heading: "Constraints",
      identical: true,
      lines: enabled.length ? enabled.map(formatConstraintLine) : ["No enabled constraints."],
    });
  } else if (snapshots.length === 2) {
    const [a, b] = snapshots;
    const aSet = new Set(a.constraints.filter((c) => c.enabled).map(formatConstraintLine));
    const bSet = new Set(b.constraints.filter((c) => c.enabled).map(formatConstraintLine));
    const onlyA = [...aSet].filter((l) => !bSet.has(l));
    const onlyB = [...bSet].filter((l) => !aSet.has(l));
    const lines: string[] = [];
    for (const l of onlyA) lines.push(`${a.name} only: ${l}`);
    for (const l of onlyB) lines.push(`${b.name} only: ${l}`);
    sections.push({
      heading: "Constraints",
      identical: false,
      lines: lines.length ? lines : ["Enabled constraints differ between scenarios."],
    });
  } else {
    sections.push({
      heading: "Constraints",
      identical: false,
      lines: snapshots.map((s) => {
        const enabled = s.constraints.filter((c) => c.enabled).map(formatConstraintLine);
        return `${s.name}: ${enabled.join("; ") || "none"}`;
      }),
    });
  }

  if (assumptionsIdentical) {
    sections.push({
      heading: "Assumptions",
      identical: true,
      lines: snapshots[0].assumptions.map(formatAssumptionLine),
    });
  } else if (snapshots.length === 2) {
    const [a, b] = snapshots;
    const byLabel = new Map(a.assumptions.map((x) => [x.label, x]));
    const lines: string[] = [];
    for (const ab of b.assumptions) {
      const aa = byLabel.get(ab.label);
      const va = aa ? `${aa.value}${aa.unit ? ` ${aa.unit}` : ""}` : "—";
      const vb = `${ab.value}${ab.unit ? ` ${ab.unit}` : ""}`;
      if (va !== vb) lines.push(`${ab.label}: ${va} → ${vb}`);
    }
    sections.push({
      heading: "Assumptions",
      identical: false,
      lines: lines.length ? lines : ["Assumptions differ between scenarios."],
    });
  } else {
    sections.push({
      heading: "Assumptions",
      identical: false,
      lines: snapshots.map((s) => `${s.name}: ${s.assumptions.map(formatAssumptionLine).join("; ")}`),
    });
  }

  const allIdentical = weightsIdentical && constraintsIdentical && assumptionsIdentical;

  return {
    allIdentical,
    identicalMessage: allIdentical ? IDENTICAL_INPUTS_MESSAGE : null,
    sections,
  };
}

export function housingTargetProgress(input: {
  target?: number;
  totalCapacity?: number;
  meetsAloneCount?: number;
  shortlistCapacity?: number;
}): HousingTargetProgress | null {
  const { target, totalCapacity, meetsAloneCount = 0, shortlistCapacity = 0 } = input;
  if (target == null || totalCapacity == null || target <= 0) return null;

  const percentOfTarget = Math.round((totalCapacity / target) * 100);
  const gap = target - totalCapacity;
  const singleParcelMeets = meetsAloneCount > 0;
  const shortlistMeets = shortlistCapacity >= target;

  let summary: string;
  if (gap <= 0) {
    summary = `${totalCapacity.toLocaleString()}/${target.toLocaleString()} homes (${percentOfTarget}% of goal) — meets target.`;
  } else {
    summary = `${totalCapacity.toLocaleString()}/${target.toLocaleString()} homes (${percentOfTarget}% of goal) — ${gap.toLocaleString()} short.`;
  }
  const parcelNote = singleParcelMeets
    ? "At least one parcel alone meets the target."
    : "No single parcel meets the target alone.";
  const shortlistNote =
    shortlistCapacity > 0
      ? shortlistMeets
        ? "Combined shortlist meets the target."
        : `Shortlist totals ${shortlistCapacity.toLocaleString()} homes — below target.`
      : "No shortlist pinned.";

  return {
    target,
    units: totalCapacity,
    percentOfTarget,
    gap,
    singleParcelMeets,
    shortlistMeets,
    shortlistCapacity,
    summary: `${summary} ${parcelNote} ${shortlistNote}`,
  };
}

export function enrichComparisonRows(
  inputs: ScenarioComparisonInput[]
): Array<Record<string, string | number>> {
  return compareScenarioMetrics(inputs).map((row, i) => {
    const input = inputs[i];
    const result = input.result;
    const candidates = result?.candidates ?? [];
    const ag = result?.aggregateMetrics ?? [];
    const getAg = (k: string) => ag.find((m) => m.key === k)?.value;

    const housingIntent = input.intent
      ? isHousingIntent(input.intent)
      : Boolean(input.housingTarget);
    const target = input.housingTarget;

    let avgFlood: number | "—" = "—";
    if (candidates.length > 0) {
      const floodVals = candidates
        .map((c) => c.metrics.find((m) => m.key === "flood_resilience")?.value)
        .filter((v): v is number => typeof v === "number");
      if (floodVals.length > 0) {
        avgFlood = Math.round(floodVals.reduce((a, b) => a + b, 0) / floodVals.length);
      }
    }

    const shortlist = input.shortlist ?? [];
    let shortlistCapacity = 0;
    if (result && shortlist.length > 0) {
      for (const entry of shortlist) {
        const candidate = candidates.find(
          (c) =>
            (entry.candidateId && c.id === entry.candidateId) ||
            entry.featureIds.some((fid) => c.featureIds.includes(fid))
        );
        shortlistCapacity +=
          candidate?.metrics.find((m) => m.key === "capacity")?.value ?? 0;
      }
    }

    const totalCap = typeof row.total_capacity === "number" ? row.total_capacity : getAg("total_capacity");
    const meetsAlone =
      typeof row.meets_target_count === "number"
        ? row.meets_target_count
        : typeof getAg("meets_target_count") === "number"
          ? (getAg("meets_target_count") as number)
          : 0;

    let housingTargetPct: string | number = "—";
    let housingTargetGap: string | number = "—";
    let shortlistMeetsTarget: string = "—";
    let shortlistCapDisplay: string | number = "—";

    if (housingIntent && target != null && typeof totalCap === "number") {
      housingTargetPct = `${Math.round((totalCap / target) * 100)}%`;
      const gapVal = target - totalCap;
      housingTargetGap = gapVal > 0 ? gapVal : gapVal === 0 ? 0 : `+${Math.abs(gapVal)}`;
      shortlistMeetsTarget =
        shortlist.length === 0
          ? "No shortlist"
          : shortlistCapacity >= target
            ? "Yes"
            : "No";
      shortlistCapDisplay = shortlist.length > 0 ? shortlistCapacity : "—";
    }

    return {
      ...row,
      avg_flood_resilience: avgFlood,
      housing_target_pct: housingTargetPct,
      housing_target_gap: housingTargetGap,
      shortlist_meets_target: shortlistMeetsTarget,
      shortlist_capacity: shortlistCapDisplay,
      _meets_alone_count: meetsAlone,
      _shortlist_capacity_num: shortlistCapacity,
      _total_capacity_num: typeof totalCap === "number" ? totalCap : -1,
      _housing_target: target ?? -1,
    } as Record<string, string | number>;
  });
}

export type CompareTableRow = {
  key: string;
  label: string;
  applicable: boolean;
  cells: string[];
  delta: string | null;
  identical: boolean;
  sortValue: number;
};

function cellIsEmpty(value: string | number | undefined): boolean {
  return value == null || value === "" || value === "—";
}

function formatCell(value: string | number | undefined): string {
  if (cellIsEmpty(value)) return "—";
  if (typeof value === "number") return value.toLocaleString();
  return String(value);
}

function parseNumeric(value: string | number | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const pct = value.match(/^(-?\d+)%$/);
    if (pct) return Number(pct[1]);
    const n = Number(value.replace(/,/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function buildCompareTableRows(
  rows: Array<Record<string, string | number>>,
  metricDefs: CompareMetricDef[] = COMPARE_METRIC_DEFS
): CompareTableRow[] {
  const tableRows: CompareTableRow[] = [];

  for (const def of metricDefs) {
    const cells = rows.map((r) => formatCell(r[def.key] as string | number | undefined));
    const applicable = cells.some((c) => c !== "—");

    let delta: string | null = null;
    let identical = true;
    let sortValue = 0;

    if (rows.length === 2 && def.numeric) {
      const a = parseNumeric(rows[0][def.key] as string | number | undefined);
      const b = parseNumeric(rows[1][def.key] as string | number | undefined);
      if (a != null && b != null) {
        const d = b - a;
        sortValue = Math.abs(d);
        identical = d === 0;
        const sign = d > 0 ? "+" : "";
        delta = `${sign}${d.toLocaleString()}`;
        if (def.key === "housing_target_pct") delta = `${sign}${d}%`;
      }
    } else if (rows.length === 2 && !def.numeric) {
      const a = cells[0];
      const b = cells[1];
      identical = a === b;
      delta = identical ? "Same" : "Changed";
      sortValue = identical ? 0 : 1;
    } else if (rows.length > 2) {
      identical = cells.every((c) => c === cells[0]);
      delta = identical ? "Same" : "Varies";
    }

    if (!identical && cells.every((c) => c === cells[0])) {
      identical = true;
    }

    tableRows.push({
      key: def.key,
      label: def.label,
      applicable,
      cells,
      delta,
      identical,
      sortValue,
    });
  }

  return tableRows;
}

export function comparisonResultsIdentical(
  rows: Array<Record<string, string | number>>,
  metricDefs: CompareMetricDef[] = COMPARE_METRIC_DEFS
): boolean {
  const tableRows = buildCompareTableRows(rows, metricDefs);
  const applicable = tableRows.filter((r) => r.applicable);
  return applicable.length > 0 && applicable.every((r) => r.identical);
}

export function buildHousingTargetSummaries(
  enrichedRows: Array<Record<string, string | number>>
): Array<{ scenarioId: string; name: string; progress: HousingTargetProgress | null }> {
  return enrichedRows.map((row) => {
    const target = row._housing_target;
    const totalCap = row._total_capacity_num;
    const meetsAlone = row._meets_alone_count;
    const shortlistCap = row._shortlist_capacity_num;
    const progress =
      typeof target === "number" &&
      target > 0 &&
      typeof totalCap === "number" &&
      totalCap >= 0
        ? housingTargetProgress({
            target,
            totalCapacity: totalCap,
            meetsAloneCount: typeof meetsAlone === "number" ? meetsAlone : 0,
            shortlistCapacity: typeof shortlistCap === "number" ? shortlistCap : 0,
          })
        : null;
    return {
      scenarioId: String(row.scenarioId),
      name: String(row.name),
      progress,
    };
  });
}
