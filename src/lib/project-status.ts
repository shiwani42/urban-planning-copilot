/** Consolidated one-line status for project list cards (home). */

export type ProjectListStatus = {
  id: string;
  name: string;
  approvedScenarioName?: string;
  activeScenarioNote?: string;
  resumeNote?: string;
  shortlistCount?: number;
  scenarioCount?: number;
  scenarioSummary?: string;
};

export function projectStatusLine(project: ProjectListStatus): string {
  const parts: string[] = [];

  if (project.approvedScenarioName) {
    parts.push(`Approved · ${project.approvedScenarioName}`);
  }

  if (project.scenarioCount != null && project.scenarioCount > 1 && project.scenarioSummary) {
    parts.push(`${project.scenarioCount} branches · ${project.scenarioSummary}`);
  }

  const activity =
    project.activeScenarioNote?.trim() || project.resumeNote?.trim() || "";
  if (activity) {
    const normalized = activity.replace(/\s+/g, " ");
    const duplicate =
      project.approvedScenarioName &&
      normalized.toLowerCase().includes(project.approvedScenarioName.toLowerCase());
    if (!duplicate) {
      parts.push(normalized);
    }
  }

  if (project.shortlistCount != null && project.shortlistCount > 0) {
    const pinLine = `${project.shortlistCount} pinned site${project.shortlistCount === 1 ? "" : "s"}`;
    if (!parts.some((p) => p.includes("shortlist") || p.includes("pinned"))) {
      parts.push(pinLine);
    }
  }

  if (parts.length === 0) {
    return "No analysis yet — open to run your first scenario.";
  }

  return parts.join(" · ");
}

export function projectStatusTone(project: ProjectListStatus): "neutral" | "ready" | "attention" {
  if (project.approvedScenarioName) return "ready";
  const line = project.activeScenarioNote ?? project.resumeNote ?? "";
  if (/stale|recalculate|pending|gap|shortfall/i.test(line)) return "attention";
  if (/complete|candidates|shortlist/i.test(line)) return "ready";
  return "neutral";
}
