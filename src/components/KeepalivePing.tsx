"use client";

import { useEffect } from "react";

/** Invisible keep-alive while a planner has the app open. */
const PING_MS = 8 * 60 * 1000;

export function KeepalivePing() {
  useEffect(() => {
    let cancelled = false;
    const ping = () => {
      if (cancelled) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void fetch("/api/ping", { cache: "no-store", keepalive: true }).catch(() => undefined);
    };
    ping();
    const id = window.setInterval(ping, PING_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
  return null;
}
