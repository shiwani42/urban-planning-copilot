/** Browser WebMCP tool execute() payloads — use isError so agents do not treat failures as ok. */
export type WebMcpExecuteResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

function truncate(value: unknown, max = 1400): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function webMcpToolOk(payload: unknown): WebMcpExecuteResult {
  return { content: [{ type: "text", text: truncate(payload) }] };
}

export function webMcpToolError(message: string): WebMcpExecuteResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Post-condition checks so WebMCP agents see the same product state as the in-app Run analysis button. */
export function assertBrowserToolProductState(tool: string, result: unknown): void {
  if (!result || typeof result !== "object") return;

  if (tool === "run_analysis") {
    const payload = result as {
      status?: string;
      candidateCount?: number;
      error?: string;
    };
    if (payload.status === "running") {
      throw new Error(
        "Analysis is still running — wait a few seconds, then call list_candidates or retry run_analysis."
      );
    }
    if (payload.status === "failed") {
      throw new Error(payload.error ?? "Analysis failed");
    }
    if (payload.status !== "completed") {
      throw new Error(
        `Analysis did not complete (status: ${payload.status ?? "unknown"}). Retry run_analysis.`
      );
    }
    if ((payload.candidateCount ?? 0) < 1) {
      throw new Error("Analysis completed but returned no candidates — check constraints and datasets.");
    }
  }
}
