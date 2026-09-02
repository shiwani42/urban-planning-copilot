/**
 * WebMCP HTTP bridge — semantic planning tools on shared domain state.
 * Tool catalog matches browser registerTool (see src/lib/webmcp/tool-definitions.ts).
 */
import {
  listToolsForCatalog,
  executePlanningTool,
  validateToolInput,
} from "@/lib/webmcp/server-handlers";

export { PLANNING_TOOL_META } from "@/lib/webmcp/tool-definitions";
export { executePlanningTool, listToolsForCatalog } from "@/lib/webmcp/server-handlers";

export function listTools() {
  return listToolsForCatalog();
}

export async function invokeTool(
  name: string,
  rawArgs: unknown
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const validationError = validateToolInput(name, args);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  try {
    const result = await executePlanningTool(name, args);
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
