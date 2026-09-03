"use client";

import { useEffect, useState } from "react";
import { getServerWaking, subscribeServerWaking } from "@/lib/server-wake";

export function ServerWakeBanner() {
  const [waking, setWaking] = useState(getServerWaking());

  useEffect(() => subscribeServerWaking(setWaking), []);

  if (!waking) return null;

  return (
    <div
      role="status"
      className="bg-primary-fixed/30 border-b border-primary-container/40 px-section-padding py-2 text-body-sm text-on-surface shrink-0"
    >
      <strong>Waking the server…</strong> This instance may have been asleep — the first request can
      take 30–60 seconds on Render free tier. Retrying automatically; the page will load when the
      server responds.
    </div>
  );
}
