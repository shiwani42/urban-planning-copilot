/** Live workspace context injected into WebMCP tool calls from the open browser tab. */
export type WebMcpBrowserContext = {
  projectId?: string;
  scenarioId?: string;
};

let liveContext: WebMcpBrowserContext = {};

export function setWebMcpBrowserContext(ctx: WebMcpBrowserContext): void {
  liveContext = { ...liveContext, ...ctx };
}

export function clearWebMcpBrowserContext(keys?: (keyof WebMcpBrowserContext)[]): void {
  if (!keys) {
    liveContext = {};
    return;
  }
  const next = { ...liveContext };
  for (const key of keys) delete next[key];
  liveContext = next;
}

export function getWebMcpBrowserContext(): WebMcpBrowserContext {
  return { ...liveContext };
}

/** Parse project id from `/workspace/:projectId` when context was not set explicitly. */
export function inferWebMcpContextFromUrl(): WebMcpBrowserContext {
  if (typeof window === "undefined") return {};
  const match = window.location.pathname.match(/^\/workspace\/([^/]+)/);
  return match ? { projectId: match[1] } : {};
}

export function resolveWebMcpBrowserContext(): WebMcpBrowserContext {
  const fromUrl = inferWebMcpContextFromUrl();
  return {
    projectId: liveContext.projectId ?? fromUrl.projectId,
    scenarioId: liveContext.scenarioId,
  };
}
