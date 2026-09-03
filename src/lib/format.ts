/** Locale-aware formatting helpers for planner-facing UI. */

const plannerDateTimeOptions: Intl.DateTimeFormatOptions = {
  dateStyle: "medium",
  timeStyle: "short",
};

const plannerTimeOptions: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

export function formatLocaleTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, plannerTimeOptions);
  } catch {
    return new Date(iso).toISOString();
  }
}

export function formatLocaleDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, plannerDateTimeOptions);
  } catch {
    return new Date(iso).toISOString();
  }
}

export function formatReportDateTime(iso: string): string {
  return formatLocaleDateTime(iso);
}

/** Collapse duplicate limitation strings (case-insensitive, trimmed). */
export function dedupeLimitations(limitations: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of limitations) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

type ActivityLike = {
  actor: "human" | "agent" | "system";
  action: string;
  summary: string;
};

export function formatActivityActorLabel(actor: ActivityLike["actor"]): string {
  switch (actor) {
    case "human":
      return "You";
    case "agent":
      return "Copilot";
    default:
      return "System";
  }
}

export function formatDecisionType(type: string): string {
  switch (type) {
    case "approve_scenario":
      return "Approved";
    case "reject_scenario":
      return "Rejected";
    case "request_changes":
      return "Changes requested";
    case "prefer_scenario":
      return "Preferred";
    case "reject_candidate":
      return "Candidate rejected";
    case "prefer_candidate":
      return "Preferred candidate";
    default:
      return type
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
  }
}

export function formatDecisionStatus(status: string): string {
  switch (status) {
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "changes_requested":
      return "Changes requested";
    case "pending":
      return "Pending review";
    case "none":
      return "No decision";
    default:
      return status.replace(/_/g, " ");
  }
}

export function formatActivitySummary(event: ActivityLike): string {
  const who = formatActivityActorLabel(event.actor);
  switch (event.action) {
    case "approve_scenario":
      return `${who} approved this scenario`;
    case "reject_scenario":
      return `${who} rejected this scenario`;
    case "request_changes":
      return `${who} requested changes`;
    case "analysis_completed":
      return `${who} completed analysis — ${event.summary}`;
    case "analysis_started":
      return `${who} started spatial analysis`;
    case "propose_plan":
      return `${who} proposed an analysis plan`;
    case "generate_report":
      return `${who} generated a planning report`;
    case "prefer_scenario":
      return `${who} selected this scenario for comparison`;
    case "reject_candidate":
      return `${who} rejected a candidate`;
    case "prefer_candidate":
      return `${who} marked a preferred candidate`;
    default:
      if (event.actor === "agent") return `Copilot: ${event.summary}`;
      if (event.actor === "human") return `You: ${event.summary}`;
      return event.summary;
  }
}

export function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Uses the runtime local hour (browser or Node process timezone). */
export function plannerGreeting(at: Date = new Date()): string {
  return `${greetingForHour(at.getHours())}, planner`;
}

export function formatRelativeTime(iso: string, at: Date = new Date()): string {
  try {
    const then = new Date(iso);
    const diffMs = at.getTime() - then.getTime();
    if (Number.isNaN(diffMs)) return formatLocaleDateTime(iso);
    const diffMins = Math.floor(diffMs / 60_000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} min ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    return formatLocaleDateTime(iso);
  } catch {
    return formatLocaleDateTime(iso);
  }
}

export function projectRecencyIso(project: {
  lastOpenedAt?: string;
  updatedAt: string;
}): string {
  return project.lastOpenedAt ?? project.updatedAt;
}
