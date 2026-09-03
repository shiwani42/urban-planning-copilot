/** Browser WebMCP tool execute() payloads — use isError so agents do not treat failures as ok. */
import {
  isPageToolTimeoutOrAbortMessage,
  PAGE_TOOL_BUDGET_MS,
} from "@/lib/webmcp/page-tool-budget";

export type WebMcpExecuteResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

export { PAGE_TOOL_BUDGET_MS };

function truncate(value: unknown, max = 1400): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

export function webMcpToolOk(payload: unknown): WebMcpExecuteResult {
  const text = truncate(payload);
  if (isPageToolTimeoutOrAbortMessage(text)) {
    return webMcpToolError(text);
  }
  return { content: [{ type: "text", text }] };
}

export function webMcpToolError(message: string): WebMcpExecuteResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function webMcpToolInProgress(payload: {
  status: "running";
  jobId?: string;
  message: string;
  pollTools?: string[];
}): WebMcpExecuteResult {
  return webMcpToolError(
    `${payload.message}${payload.jobId ? ` (jobId: ${payload.jobId})` : ""}${
      payload.pollTools?.length ? ` — poll: ${payload.pollTools.join(", ")}` : ""
    }`
  );
}

export function coerceBrowserToolFailure(err: unknown): WebMcpExecuteResult {
  if (err instanceof Error && err.name === "AbortError") {
    return webMcpToolError("Timed out waiting for tool to finish");
  }
  const message = err instanceof Error ? err.message : String(err);
  if (isPageToolTimeoutOrAbortMessage(message)) {
    return webMcpToolError(message);
  }
  return webMcpToolError(message);
}

/** Post-condition checks so WebMCP agents see the same product state as the in-app Run analysis button. */
export function assertBrowserToolProductState(tool: string, result: unknown): void {
  if (!result || typeof result !== "object") return;

  if (tool === "run_analysis") {
    const payload = result as {
      status?: string;
      candidateCount?: number;
      error?: string;
      jobId?: string;
      pollTools?: string[];
      message?: string;
    };
    if (payload.status === "running") {
      const poll = payload.pollTools?.join(" or ") ?? "list_candidates or get_workspace";
      throw new Error(
        payload.message ??
          `Analysis is still running — poll ${poll} until status is completed, then retry run_analysis if needed.`
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
