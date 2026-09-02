import type { AppStore } from "./types";

/** Fill missing store fields in place — never replace a readable store with empty arrays. */
export function normalizeStoreShape(store: Partial<AppStore> & Record<string, unknown>): AppStore {
  const version = typeof store.version === "number" ? store.version : 1;
  return {
    version,
    projects: Array.isArray(store.projects) ? store.projects : [],
    scenarios: Array.isArray(store.scenarios) ? store.scenarios : [],
    decisions: Array.isArray(store.decisions) ? store.decisions : [],
    activities: Array.isArray(store.activities) ? store.activities : [],
    confirmations: Array.isArray(store.confirmations) ? store.confirmations : [],
    proposals: Array.isArray(store.proposals) ? store.proposals : [],
    analysisJobs: Array.isArray(store.analysisJobs) ? store.analysisJobs : [],
    analysisResults: Array.isArray(store.analysisResults) ? store.analysisResults : [],
    reports: Array.isArray(store.reports) ? store.reports : [],
    datasets: Array.isArray(store.datasets) ? store.datasets : [],
    featuresByDataset:
      store.featuresByDataset && typeof store.featuresByDataset === "object"
        ? (store.featuresByDataset as AppStore["featuresByDataset"])
        : {},
  };
}

export function projectCountFromRawJson(raw: string): number | null {
  if (!raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as { projects?: unknown };
    return Array.isArray(parsed.projects) ? parsed.projects.length : null;
  } catch {
    return null;
  }
}
