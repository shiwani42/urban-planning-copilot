import * as turf from "@turf/turf";
import type { CriterionWeight, Scenario } from "./types";
import { ToolError } from "./tool-errors";
import { assessObjectiveQuality } from "./objective";
import { STUDY_BOUNDS } from "./study-bounds";

const DESTRUCTIVE_OBJECTIVE_RE =
  /\b(delete\s+everything|clear\s+all|remove\s+all|wipe\s+(?:the\s+)?(?:project|workspace|scenario)|reset\s+everything|erase\s+all)\b/i;

const SUPPORTED_PROPOSAL_ACTIONS = new Set([
  "update_weights",
  "update_constraints",
  "set_transit_threshold",
  "approve_scenario",
]);

export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw == null) return {};
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      throw new ToolError("INVALID_INPUT", "arguments must be a JSON object", "arguments");
    } catch (err) {
      if (err instanceof ToolError) throw err;
      throw new ToolError("INVALID_INPUT", "arguments must be valid JSON", "arguments");
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  throw new ToolError("INVALID_INPUT", "arguments must be an object", "arguments");
}

export function assertNonEmptyProjectId(projectId: unknown): string {
  if (typeof projectId !== "string" || !projectId.trim()) {
    throw new ToolError("MISSING_FIELD", "projectId is required", "projectId");
  }
  return projectId.trim();
}

export function assertObjectiveTextAllowed(text: unknown): string {
  if (typeof text !== "string" || !text.trim()) {
    throw new ToolError(
      "INVALID_INPUT",
      "objectiveText cannot be empty — describe what you want to analyze",
      "objectiveText"
    );
  }
  const trimmed = text.trim();
  if (DESTRUCTIVE_OBJECTIVE_RE.test(trimmed)) {
    throw new ToolError(
      "DESTRUCTIVE_ACTION",
      "This objective looks destructive. Use explicit scenario or project tools instead of wiping requirements via natural language.",
      "objectiveText"
    );
  }
  const quality = assessObjectiveQuality(trimmed);
  if (!quality.interpretable) {
    throw new ToolError(
      "INVALID_INPUT",
      quality.warning ?? "Planning objective is not interpretable",
      "objectiveText"
    );
  }
  return trimmed;
}

export function assertTransitThresholdMeters(meters: unknown): number {
  const value = Number(meters);
  if (!Number.isFinite(value) || value < 1) {
    throw new ToolError(
      "INVALID_INPUT",
      "meters must be a number >= 1",
      "meters"
    );
  }
  if (value > 50_000) {
    throw new ToolError(
      "INVALID_INPUT",
      "meters must be <= 50000 for a realistic transit proximity threshold",
      "meters"
    );
  }
  return value;
}

export function assertPriorityWeights(
  scenario: Scenario,
  weightsInput: unknown
): CriterionWeight[] {
  if (!weightsInput || typeof weightsInput !== "object" || Array.isArray(weightsInput)) {
    throw new ToolError("INVALID_INPUT", "weights must be an object map of criterion key → number", "weights");
  }
  const wmap = weightsInput as Record<string, unknown>;
  const known = new Set(scenario.weights.map((w) => w.key));
  const unknown = Object.keys(wmap).filter((k) => !known.has(k));
  if (unknown.length) {
    throw new ToolError(
      "UNKNOWN_FIELD",
      `Unknown weight keys: ${unknown.join(", ")}. Valid keys: ${[...known].join(", ")}`,
      "weights"
    );
  }
  const updated = scenario.weights.map((w) => {
    if (wmap[w.key] === undefined) return w;
    const n = Number(wmap[w.key]);
    if (!Number.isFinite(n) || n < 0) {
      throw new ToolError(
        "INVALID_INPUT",
        `Weight for "${w.key}" must be a non-negative number`,
        `weights.${w.key}`
      );
    }
    return { ...w, weight: n };
  });
  return updated;
}

export function assertCompareScenarioIds(scenarioIds: unknown): string[] {
  if (!Array.isArray(scenarioIds)) {
    throw new ToolError("INVALID_INPUT", "scenarioIds must be an array", "scenarioIds");
  }
  const ids = scenarioIds.map((id) => String(id).trim()).filter(Boolean);
  if (ids.length < 2) {
    throw new ToolError(
      "INVALID_INPUT",
      "At least two scenario ids are required for comparison",
      "scenarioIds"
    );
  }
  return ids;
}

export function assertProposalAction(action: unknown, payload: unknown): void {
  if (typeof action !== "string" || !action.trim()) {
    throw new ToolError("MISSING_FIELD", "action is required", "action");
  }
  if (!SUPPORTED_PROPOSAL_ACTIONS.has(action)) {
    throw new ToolError(
      "UNSUPPORTED_ACTION",
      `Unsupported proposal action: ${action}. Supported: ${[...SUPPORTED_PROPOSAL_ACTIONS].join(", ")}`,
      "action"
    );
  }
  const body = payload && typeof payload === "object" && !Array.isArray(payload)
    ? (payload as Record<string, unknown>)
    : {};
  if (action === "set_transit_threshold") {
    assertTransitThresholdMeters(body.meters);
  }
  if (action === "approve_scenario" && body.reason != null && typeof body.reason !== "string") {
    throw new ToolError("INVALID_INPUT", "reason must be a string when provided", "payload.reason");
  }
}

export function humanizeProposalTitle(title: string, action: string): string {
  const trimmed = title.trim();
  const withoutRevision = trimmed
    .replace(/\s*[-—]\s*revision\s+[a-f0-9]{6,}\b/i, "")
    .replace(/\s+revision\s+[a-f0-9]{6,}\b/i, "")
    .trim();
  if (withoutRevision.length >= 3) return withoutRevision;
  switch (action) {
    case "set_transit_threshold":
      return "Adjust transit proximity threshold";
    case "update_weights":
      return "Update ranking weights";
    case "update_constraints":
      return "Update planning constraints";
    case "approve_scenario":
      return "Approve scenario decision";
    default:
      return "Review proposed change";
  }
}

export function validatePolygonRing(coordinates: unknown): number[][] {
  if (!Array.isArray(coordinates) || coordinates.length < 3) {
    throw new ToolError(
      "INVALID_INPUT",
      "coordinates require at least 3 [lng,lat] pairs",
      "coordinates"
    );
  }
  const ring: number[][] = [];
  for (let i = 0; i < coordinates.length; i++) {
    const pair = coordinates[i];
    if (!Array.isArray(pair) || pair.length < 2) {
      throw new ToolError(
        "INVALID_INPUT",
        `coordinates[${i}] must be [lng, lat]`,
        "coordinates"
      );
    }
    const lng = Number(pair[0]);
    const lat = Number(pair[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
      throw new ToolError(
        "INVALID_INPUT",
        `coordinates[${i}] must contain finite numbers`,
        "coordinates"
      );
    }
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new ToolError(
        "INVALID_INPUT",
        `coordinates[${i}] lng/lat out of range`,
        "coordinates"
      );
    }
    ring.push([lng, lat]);
  }
  const closed =
    ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]
      ? [...ring, ring[0]]
      : ring;
  try {
    const poly = turf.polygon([closed]);
    if (!turf.booleanValid(poly)) {
      throw new ToolError("INVALID_GEOMETRY", "Polygon geometry is not valid", "coordinates");
    }
    const centroid = turf.centroid(poly);
    const [lng, lat] = centroid.geometry.coordinates;
    if (
      lng < STUDY_BOUNDS.west - 0.05 ||
      lng > STUDY_BOUNDS.east + 0.05 ||
      lat < STUDY_BOUNDS.south - 0.05 ||
      lat > STUDY_BOUNDS.north + 0.05
    ) {
      throw new ToolError(
        "OUT_OF_BOUNDS",
        "Polygon must lie within the project study area bounds",
        "coordinates"
      );
    }
  } catch (err) {
    if (err instanceof ToolError) throw err;
    throw new ToolError("INVALID_GEOMETRY", "Unable to parse polygon coordinates", "coordinates");
  }
  return closed;
}

export function assertExclusionLabel(label: unknown): string {
  if (typeof label !== "string" || !label.trim()) {
    throw new ToolError("MISSING_FIELD", "label is required for geographic exclusions", "label");
  }
  return label.trim();
}
