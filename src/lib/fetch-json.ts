export type FetchJsonResult<T> = {
  ok: boolean;
  status: number;
  data: T;
};

function humanFetchError(status: number, serverMessage?: string): string {
  if (serverMessage && serverMessage.trim().length > 0) return serverMessage;
  if (status === 404) return "Project not found";
  if (status >= 500) return "Server error — try again in a moment";
  if (status === 0) return "Network error — check your connection";
  return `Request failed (${status})`;
}

function parseJsonBody<T>(text: string, label: string): T {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${label}: empty response from server`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    throw new Error(`${label}: invalid response from server`);
  }
}

/**
 * Fetch JSON with retry for empty/partial bodies and transient network failures.
 */
export async function fetchJsonWithRetry<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retries?: number; label?: string }
): Promise<FetchJsonResult<T>> {
  const retries = options?.retries ?? 2;
  const label = options?.label ?? "Request";
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(input, init);
      const text = await res.text();
      const data = parseJsonBody<T>(text, label);
      if (!res.ok) {
        const message = humanFetchError(
          res.status,
          typeof (data as { error?: string }).error === "string"
            ? (data as { error: string }).error
            : undefined
        );
        throw new Error(message);
      }
      return { ok: true, status: res.status, data };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
      }
    }
  }

  throw lastError ?? new Error(`${label} failed`);
}
