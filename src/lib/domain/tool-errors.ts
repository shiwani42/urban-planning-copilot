/** Structured tool error for WebMCP and HTTP /api/mcp responses. */
export type ToolErrorPayload = {
  code: string;
  field?: string;
  message: string;
};

export class ToolError extends Error {
  readonly code: string;
  readonly field?: string;

  constructor(code: string, message: string, field?: string) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.field = field;
  }

  toJSON(): ToolErrorPayload {
    return {
      code: this.code,
      field: this.field,
      message: this.message,
    };
  }
}

export function isToolError(err: unknown): err is ToolError {
  return err instanceof ToolError;
}

export function toolErrorPayload(err: unknown): ToolErrorPayload {
  if (isToolError(err)) return err.toJSON();
  const message = err instanceof Error ? err.message : String(err);
  return { code: "INTERNAL_ERROR", message };
}

export function formatToolErrorMessage(payload: ToolErrorPayload): string {
  const field = payload.field ? ` (${payload.field})` : "";
  return `[${payload.code}]${field} ${payload.message}`;
}
