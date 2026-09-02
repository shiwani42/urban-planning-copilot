"use client";

import { useEffect, useState } from "react";
import { registerPlanningWebMcpTools } from "@/lib/webmcp/register-browser";

/**
 * Registers browser WebMCP tools (document.modelContext) for the live page.
 * Progressive enhancement — app works without WebMCP support.
 *
 * Debug with nekuda WebMCP Workbench:
 * https://chromewebstore.google.com/detail/nekuda-webmcp-workbench/amochnnbmnkjjlblolhpddkokhnalkjp
 */
export function WebMcpProvider({
  projectId,
  children,
}: {
  projectId?: string | null;
  children?: React.ReactNode;
}) {
  const [status, setStatus] = useState<"off" | "on" | "unsupported">("off");
  const [toolCount, setToolCount] = useState(0);

  useEffect(() => {
    let aborted = false;
    let cleanup: (() => void) | undefined;

    (async () => {
      const reg = await registerPlanningWebMcpTools({ projectId });
      if (aborted) {
        reg.abort();
        return;
      }
      cleanup = reg.abort;
      setToolCount(reg.toolCount);
      setStatus(reg.available ? "on" : "unsupported");
    })().catch(() => {
      if (!aborted) setStatus("unsupported");
    });

    return () => {
      aborted = true;
      cleanup?.();
    };
  }, [projectId]);

  return (
    <>
      {children}
      {status === "on" && process.env.NEXT_PUBLIC_SHOW_WEBMCP_UI === "true" && (
        <div
          className="fixed bottom-2 left-2 z-[9999] pointer-events-none font-mono text-[10px] uppercase tracking-wider text-primary-container bg-primary-fixed/80 border border-primary-fixed px-2 py-1 rounded"
          title="Browser WebMCP tools registered for co-browsing agents"
          aria-hidden
        >
          WebMCP · {toolCount} tools
        </div>
      )}
    </>
  );
}
