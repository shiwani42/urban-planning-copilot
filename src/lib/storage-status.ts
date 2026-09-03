"use client";

import { useCallback, useEffect, useState } from "react";

export type ClientStorageStatus = {
  status: "loading" | "healthy" | "degraded" | "unknown" | "error";
  onPersistentMount?: boolean;
  writeProbeOk?: boolean;
  projectCount?: number;
  storeExists?: boolean;
  lastBoot?: string;
  message?: string;
  fetchError?: string;
};

type HealthPayload = {
  status?: string;
  storage?: {
    status?: string;
    onPersistentMount?: boolean;
    writeProbeOk?: boolean;
    projectCount?: number;
    storeExists?: boolean;
    lastBoot?: string;
    message?: string;
    storeReadError?: string;
  };
};

function normalizeHealthPayload(data: HealthPayload): ClientStorageStatus {
  const storage = data.storage ?? {};
  const topStatus = data.status ?? storage.status ?? "unknown";
  const writeProbeOk = storage.writeProbeOk;
  const onPersistentMount = storage.onPersistentMount;

  if (writeProbeOk === false) {
    return {
      status: "degraded",
      onPersistentMount,
      writeProbeOk: false,
      projectCount: storage.projectCount,
      storeExists: storage.storeExists,
      lastBoot: storage.lastBoot,
      message: storage.message ?? storage.storeReadError ?? "Write probe failed",
    };
  }

  if (topStatus === "healthy") {
    return {
      status: "healthy",
      onPersistentMount,
      writeProbeOk: writeProbeOk ?? true,
      projectCount: storage.projectCount,
      storeExists: storage.storeExists,
      lastBoot: storage.lastBoot,
      message: storage.message,
    };
  }

  if (topStatus === "degraded") {
    return {
      status: "degraded",
      onPersistentMount,
      writeProbeOk,
      projectCount: storage.projectCount,
      storeExists: storage.storeExists,
      lastBoot: storage.lastBoot,
      message: storage.message ?? storage.storeReadError,
    };
  }

  return {
    status: "unknown",
    onPersistentMount,
    writeProbeOk,
    projectCount: storage.projectCount,
    storeExists: storage.storeExists,
    lastBoot: storage.lastBoot,
    message: storage.message,
  };
}

export function shouldShowStorageUnavailableBanner(
  storage: ClientStorageStatus | null
): boolean {
  if (!storage || storage.status === "loading" || storage.status === "healthy") {
    return false;
  }
  if (storage.status === "error") {
    return true;
  }
  if (storage.status === "degraded") {
    return true;
  }
  if (storage.status === "unknown" && storage.writeProbeOk === false) {
    return true;
  }
  return false;
}

export function useStorageStatus(): ClientStorageStatus & { refresh: () => void } {
  const [storage, setStorage] = useState<ClientStorageStatus>({ status: "loading" });

  const refresh = useCallback(() => {
    setStorage((prev) => ({ ...prev, status: prev.status === "loading" ? "loading" : prev.status }));
    fetch("/api/health", { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as HealthPayload;
        if (!r.ok) {
          throw new Error(
            typeof (data as { error?: string }).error === "string"
              ? (data as { error: string }).error
              : `Health check failed (${r.status})`
          );
        }
        setStorage(normalizeHealthPayload(data));
      })
      .catch((err) => {
        setStorage({
          status: "error",
          fetchError: err instanceof Error ? err.message : String(err),
          message: "Could not verify workspace storage health.",
        });
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...storage, refresh };
}
