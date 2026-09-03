/**
 * Normalize objective text when start_planning_project also receives geographyLabel.
 * Never splice geography into the middle of existing text — append only when absent.
 */
export function resolveObjectiveTextWithGeography(
  objectiveText: string,
  geographyLabel?: string
): string {
  const text = objectiveText.trim();
  const geo = geographyLabel?.trim();
  if (!text) return text;
  if (!geo || geo === "Study area") return text;

  const lowerText = text.toLowerCase();
  const lowerGeo = geo.toLowerCase();
  if (lowerText.includes(lowerGeo)) return text;

  const suffix = ` in ${geo}`;
  if (lowerText.endsWith(suffix.toLowerCase())) return text;

  // Objective already names the geography root (e.g. "in Mission" with label "Mission/SoMa, San Francisco").
  const geoRoot = geo.split(/[,/—–-]/)[0]?.trim().toLowerCase();
  if (geoRoot && geoRoot.length >= 4) {
    const inRoot = new RegExp(`\\bin\\s+${escapeRegExp(geoRoot)}\\b`, "i");
    if (inRoot.test(text)) return text;
  }

  return `${text}${suffix}`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
