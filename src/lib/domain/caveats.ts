/** Filter dataset limitations to analysis-relevant, deduped caveats. */
export function filterAnalysisCaveats(
  limitations: string[],
  options?: { max?: number; analysisType?: string }
): string[] {
  const max = options?.max ?? 6;
  const scored = limitations.map((text) => ({
    text,
    severity: caveatSeverity(text),
  }));
  scored.sort((a, b) => b.severity - a.severity);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of scored) {
    const key = item.text.toLowerCase().slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.text);
    if (out.length >= max) break;
  }
  return out;
}

function caveatSeverity(text: string): number {
  const lower = text.toLowerCase();
  if (/incomplete|partial|clip|synthetic|illustrative|not authoritative|outdated|stale/.test(lower)) {
    return 3;
  }
  if (/demo|snapshot|verify|approximate|simplified/.test(lower)) {
    return 2;
  }
  return 1;
}
