import { ToolError } from "@/lib/domain/tool-errors";

/** Accept [lng, lat], a comma-separated string, or a JSON stringified array from agent forms. */
export function parseMapCenter(input: unknown): [number, number] {
  if (Array.isArray(input) && input.length >= 2) {
    return finiteLngLat(Number(input[0]), Number(input[1]));
  }

  if (typeof input === "string") {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new ToolError("INVALID_INPUT", "center must be [lng, lat]", "center");
    }

    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (Array.isArray(parsed) && parsed.length >= 2) {
          return finiteLngLat(Number(parsed[0]), Number(parsed[1]));
        }
      } catch {
        /* fall through to comma parsing */
      }
    }

    const comma = trimmed.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (comma) {
      return finiteLngLat(Number(comma[1]), Number(comma[2]));
    }
  }

  throw new ToolError("INVALID_INPUT", "center must be [lng, lat] or a comma-separated lng,lat string", "center");
}

function finiteLngLat(lng: number, lat: number): [number, number] {
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
    throw new ToolError("INVALID_INPUT", "center must contain finite numbers", "center");
  }
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) {
    throw new ToolError("INVALID_INPUT", "center coordinates are out of range", "center");
  }
  return [lng, lat];
}
