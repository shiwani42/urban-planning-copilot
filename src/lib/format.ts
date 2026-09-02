/** Locale-aware formatting helpers for planner-facing UI. */

/** Planner-facing timestamps use IST so list, detail, and report bodies agree. */
export const PLANNER_TIME_ZONE = "Asia/Kolkata";

const plannerDateTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: PLANNER_TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
};

const plannerTimeOptions: Intl.DateTimeFormatOptions = {
  timeZone: PLANNER_TIME_ZONE,
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

export function plannerGreeting(): string {
  return `${greetingForHour(new Date().getHours())}, planner`;
}
