/**
 * Browser WebMCP types (document.modelContext).
 * Spec: https://github.com/webmachinelearning/webmcp
 * Docs: https://developer.chrome.com/docs/ai/webmcp
 * Security: https://developer.chrome.com/docs/ai/webmcp/secure-tools
 */

export type JsonSchema = {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number | boolean>;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
};

export type WebMcpAnnotations = {
  readOnlyHint?: boolean;
  untrustedContentHint?: boolean;
  destructiveHint?: boolean;
  openWorldHint?: boolean;
};

export type ModelContextClient = {
  requestUserInteraction: <T>(callback: () => Promise<T> | T) => Promise<T>;
};

export type WebMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: WebMcpAnnotations;
  execute: (
    input: Record<string, unknown>,
    client?: ModelContextClient
  ) => Promise<unknown> | unknown;
};

export type ModelContext = {
  registerTool: (
    tool: WebMcpToolDefinition,
    options?: { signal?: AbortSignal; exposedTo?: string[] }
  ) => Promise<void> | void;
  getTools?: () => unknown[];
  executeTool?: (tool: unknown, argsJson: string) => Promise<string>;
};

declare global {
  interface Document {
    modelContext?: ModelContext;
  }
  interface Navigator {
    modelContext?: ModelContext;
  }
}

export function getModelContext(): ModelContext | null {
  if (typeof document === "undefined") return null;
  const ctx = document.modelContext ?? navigator.modelContext;
  if (ctx && typeof ctx.registerTool === "function") return ctx;
  return null;
}
