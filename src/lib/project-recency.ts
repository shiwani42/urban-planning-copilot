/** Browser-only hints when the server project list is empty but this tab had recent work. */

const STORAGE_KEY = "upc:recent-projects";
const MAX_ENTRIES = 8;

export type RecentProjectHint = {
  id: string;
  name: string;
  lastSeenAt: string;
};

function read(): RecentProjectHint[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentProjectHint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function write(entries: RecentProjectHint[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota / private mode */
  }
}

export function trackRecentProject(id: string, name: string): void {
  const now = new Date().toISOString();
  const rest = read().filter((e) => e.id !== id);
  write([{ id, name, lastSeenAt: now }, ...rest]);
}

export function getRecentProjectHints(): RecentProjectHint[] {
  return read();
}

export function clearRecentProjectHint(id: string): void {
  write(read().filter((e) => e.id !== id));
}
