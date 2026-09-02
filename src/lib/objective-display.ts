/**
 * Extract a housing count from a project title like "Pass15 Mission 600 homes".
 */
export function homesCountInTitle(title: string): number | undefined {
  const match = title.match(/(\d[\d,]*)\s*homes?\b/i);
  if (!match) return undefined;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Returns a warning when the project title implies a different housing target
 * than the parsed objective.
 */
export function objectiveTitleMismatchWarning(
  projectName: string,
  objectiveTarget?: number
): string | null {
  if (objectiveTarget == null || !Number.isFinite(objectiveTarget)) return null;
  const fromTitle = homesCountInTitle(projectName);
  if (fromTitle == null || fromTitle === objectiveTarget) return null;
  return `Project title suggests ${fromTitle.toLocaleString()} homes, but the parsed objective target is ${objectiveTarget.toLocaleString()} homes.`;
}
