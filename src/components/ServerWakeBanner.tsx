"use client";

import { useEffect, useState } from "react";
import { SERVER_WAKE_HEADING, SERVER_WAKE_MESSAGE } from "@/lib/planner-copy";
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
      <strong>{SERVER_WAKE_HEADING}</strong> {SERVER_WAKE_MESSAGE}
    </div>
  );
}
