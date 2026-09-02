/**
 * WebMCP HTTP bridge — semantic planning tools on shared domain state.
 * Tool catalog matches browser registerTool (see src/lib/webmcp/tool-definitions.ts).
 */
import {
  listToolsForCatalog,
  executePlanningTool,
  validateToolInput,
} from "@/lib/webmcp/server-handlers";
import { parseToolArguments } from "@/lib/domain/webmcp-validation";
import { isToolError, toolErrorPayload, type ToolErrorPayload } from "@/lib/domain/tool-errors";
import { mergeToolContext, type ToolExecutionContext } from "@/lib/webmcp/tool-context";

export { PLANNING_TOOL_META } from "@/lib/webmcp/tool-definitions";
export { executePlanningTool, listToolsForCatalog } from "@/lib/webmcp/server-handlers";

export function listTools() {
  return listToolsForCatalog();
}

export type InvokeToolResult =
  | { ok: true; result: unknown; projectId?: string }
  | { ok: false; error: ToolErrorPayload };

export async function invokeTool(
  name: string,
  rawArgs: unknown,
  context?: ToolExecutionContext
): Promise<InvokeToolResult> {
  let args: Record<string, unknown>;
  try {
    args = parseToolArguments(rawArgs);
  } catch (err) {
    return { ok: false, error: toolErrorPayload(err) };
  }

  const mergedArgs = mergeToolContext(args, context);
  const validationError = validateToolInput(name, mergedArgs, context);
  if (validationError) {
    return {
      ok: false,
      error: {
        code: validationError.code,
        field: validationError.field,
        message: validationError.message,
      },
    };
  }

  try {
    const result = await executePlanningTool(name, mergedArgs, context);
    const projectId =
      typeof mergedArgs.projectId === "string"
        ? mergedArgs.projectId
        : result &&
            typeof result === "object" &&
            result !== null &&
            "projectId" in result &&
            typeof (result as { projectId?: unknown }).projectId === "string"
          ? (result as { projectId: string }).projectId
          : undefined;
    return { ok: true, result, projectId };
  } catch (err) {
    return { ok: false, error: toolErrorPayload(err) };
  }
}

export { isToolError, formatToolErrorMessage } from "@/lib/domain/tool-errors";
