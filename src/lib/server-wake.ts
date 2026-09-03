import { fetchJsonWithRetry } from "@/lib/fetch-json";

/** Render free tier cold starts often exceed this before the first response. */
export const SERVER_WAKE_THRESHOLD_MS = 3000;

type WakeListener = (waking: boolean) => void;

let serverWaking = false;
const listeners = new Set<WakeListener>();

export function getServerWaking(): boolean {
  return serverWaking;
}

export function subscribeServerWaking(listener: WakeListener): () => void {
  listeners.add(listener);
  listener(serverWaking);
  return () => listeners.delete(listener);
}

function setServerWaking(value: boolean) {
  if (serverWaking === value) return;
  serverWaking = value;
  for (const listener of listeners) {
    listener(value);
  }
}

/**
 * Fetch JSON with a visible wake state when the first attempt is slow or fails.
 * Does not fake success — callers still receive the real result or error.
 */
export async function fetchJsonWithServerWake<T>(
  input: RequestInfo | URL,
  init?: RequestInit,
  options?: { retries?: number; label?: string }
): Promise<T> {
  const label = options?.label ?? "Request";
  const retries = options?.retries ?? 2;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let wakeShown = false;

  const showWake = () => {
    if (wakeShown) return;
    wakeShown = true;
    setServerWaking(true);
  };

  slowTimer = setTimeout(showWake, SERVER_WAKE_THRESHOLD_MS);

  try {
    const { data } = await fetchJsonWithRetry<T>(input, init, { label, retries });
    return data;
  } catch (error) {
    showWake();
    throw error;
  } finally {
    if (slowTimer) clearTimeout(slowTimer);
    setServerWaking(false);
  }
}
