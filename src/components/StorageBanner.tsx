"use client";

import { useEffect, useState } from "react";

type StorageStatus = {
  status: "healthy" | "degraded" | "unknown";
  message?: string;
  onPersistentMount?: boolean;
  projectCount?: number;
};

export function StorageBanner() {
  const [storage, setStorage] = useState<StorageStatus | null>(null);

  useEffect(() => {
    fetch("/api/health", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setStorage(d.storage ?? null))
      .catch(() => {
        setStorage({
          status: "degraded",
          message: "Could not verify workspace storage health.",
        });
      });
  }, []);

  if (!storage || storage.status === "healthy") return null;

  return (
    <div
      role="alert"
      className="bg-error-container/30 border-b border-error/40 px-section-padding py-2 text-body-sm text-on-error-container shrink-0"
    >
      <strong>Workspace storage degraded.</strong>{" "}
      {storage.message ??
        "Projects may not persist across restarts. Contact your administrator or check Render disk mount."}
      {storage.onPersistentMount === false && (
        <span className="block text-caption mt-0.5">
          DATA_DIR is not on the Render persistent disk mount — running in ephemeral mode.
        </span>
      )}
    </div>
  );
}
