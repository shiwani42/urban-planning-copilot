import type { AnalysisResult, Candidate, Scenario, ShortlistEntry } from "./types";

export type ResolvedShortlistEntry = ShortlistEntry & {
  candidate?: Candidate;
  /** True when the pinned parcel is not in the current result set */
  missing?: boolean;
};

export function shortlistEntries(scenario: Scenario): ShortlistEntry[] {
  return scenario.shortlist ?? [];
}

export function featureIdsOverlap(a: string[], b: string[]): boolean {
  const set = new Set(a);
  return b.some((id) => set.has(id));
}

export function findCandidateInResult(
  result: AnalysisResult | undefined,
  candidateId: string
): Candidate | undefined {
  if (!result) return undefined;
  return result.candidates.find(
    (c) => c.id === candidateId || c.featureIds.includes(candidateId)
  );
}

export function findShortlistEntry(
  entries: ShortlistEntry[],
  candidateId: string,
  featureIds?: string[]
): ShortlistEntry | undefined {
  return entries.find(
    (e) =>
      e.candidateId === candidateId ||
      (featureIds && featureIdsOverlap(e.featureIds, featureIds)) ||
      e.featureIds.includes(candidateId)
  );
}

export function isCandidateShortlisted(
  scenario: Scenario,
  candidate: Candidate
): boolean {
  return Boolean(
    findShortlistEntry(shortlistEntries(scenario), candidate.id, candidate.featureIds)
  );
}

export function resolveShortlist(
  scenario: Scenario,
  result: AnalysisResult | undefined
): ResolvedShortlistEntry[] {
  const entries = shortlistEntries(scenario);
  return entries.map((entry) => {
    const candidate = result?.candidates.find(
      (c) =>
        (entry.candidateId && c.id === entry.candidateId) ||
        featureIdsOverlap(c.featureIds, entry.featureIds)
    );
    return {
      ...entry,
      candidate,
      label: candidate?.label ?? entry.label,
      candidateId: candidate?.id ?? entry.candidateId,
      missing: !candidate,
    };
  });
}

export function shortlistPinReason(entry: ShortlistEntry): string {
  return entry.reason?.trim() || "Pinned from Results";
}

export function remapShortlistAfterAnalysis(
  shortlist: ShortlistEntry[],
  candidates: Candidate[]
): ShortlistEntry[] {
  const next: ShortlistEntry[] = [];
  for (const entry of shortlist) {
    const match = candidates.find(
      (c) =>
        (entry.candidateId && c.id === entry.candidateId) ||
        featureIdsOverlap(c.featureIds, entry.featureIds)
    );
    if (!match || match.status === "rejected") continue;
    next.push({
      ...entry,
      candidateId: match.id,
      label: match.label,
      featureIds: [...match.featureIds],
    });
  }
  return next;
}
