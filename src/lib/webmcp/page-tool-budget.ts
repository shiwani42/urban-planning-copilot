/** Nekuda WebMCP Workbench page-tool budget (~30s). Stay under this in browser execute(). */
export const PAGE_TOOL_BUDGET_MS = 25_000;

export function getPageToolBudgetMs(): number {
  const override = Number(process.env.UPC_PAGE_TOOL_BUDGET_MS);
  return Number.isFinite(override) && override > 0 ? override : PAGE_TOOL_BUDGET_MS;
}

export const PAGE_TOOL_POLL_MS = 400;

const TIMEOUT_ABORT_PATTERNS = [
  /timed out waiting for page tool/i,
  /page tool.*timed out/i,
  /aborted/i,
  /abort(?:ed|ing)/i,
  /the operation was aborted/i,
  /signal is aborted/i,
];

export function isPageToolTimeoutOrAbortMessage(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return TIMEOUT_ABORT_PATTERNS.some((pattern) => pattern.test(text));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class PageToolBudgetExceeded extends Error {
  constructor(message = "Page tool budget exceeded") {
    super(message);
    this.name = "PageToolBudgetExceeded";
  }
}

/** Race work against the page-tool budget; reject with PageToolBudgetExceeded when time runs out. */
export async function runWithPageToolBudget<T>(
  work: (signal: AbortSignal) => Promise<T>,
  budgetMs: number = PAGE_TOOL_BUDGET_MS
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new PageToolBudgetExceeded("Timed out waiting for tool to finish"));
    }, budgetMs);
  });
  try {
    return await Promise.race([work(controller.signal), budget]);
  } catch (err) {
    if (err instanceof PageToolBudgetExceeded) throw err;
    if (controller.signal.aborted) {
      throw new PageToolBudgetExceeded(
        err instanceof Error ? err.message : "Timed out waiting for tool to finish"
      );
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
