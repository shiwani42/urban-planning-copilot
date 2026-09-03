"use client";

import { useCallback, useEffect, useState } from "react";

export type PersistBackend = "postgres" | "file";

export type ClientStorageStatus = {
  status: "loading" | "healthy" | "degraded" | "unknown" | "error";
  onPersistentMount?: boolean;
  writeProbeOk?: boolean;
  persistBackend?: PersistBackend;
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
    persistBackend?: PersistBackend;
    projectCount?: number;
    storeExists?: boolean;
    lastBoot?: string;
    message?: string;
    storeReadError?: string;
  };
};

/** True when the server catalog is expected to survive instance restarts and deploys. */
export function projectsPersistReliably(storage: ClientStorageStatus | null): boolean {
  if (!storage || storage.status === "loading") return false;
  if (storage.status === "error" || storage.status === "degraded") return false;
  if (storage.writeProbeOk === false) return false;
  if (storage.persistBackend === "file") return false;
  if (storage.storeExists === false) return false;
  if (storage.lastBoot === "empty-after-missing-file") return false;
  return storage.status === "healthy";
}

export function storageReliabilityIssue(storage: ClientStorageStatus | null): string | null {
  if (!storage || storage.status === "loading") return null;
  if (storage.fetchError) return storage.fetchError;
  if (storage.status === "error") {
    return storage.message ?? "Could not verify workspace storage health.";
  }
  if (storage.writeProbeOk === false) {
    return storage.message ?? "Workspace storage write probe failed.";
  }
  if (storage.persistBackend === "file") {
    return "Workspace catalog uses ephemeral file storage — projects are lost when this server instance restarts. Set DATABASE_URL for durable Postgres storage.";
  }
  if (storage.lastBoot === "empty-after-missing-file" || storage.storeExists === false) {
    return "Workspace catalog is missing or was reset after a deploy — saved projects may not be available.";
  }
  if (storage.status === "degraded") {
    return storage.message ?? "Workspace storage is degraded.";
  }
  return null;
}

function normalizeHealthPayload(data: HealthPayload): ClientStorageStatus {
  const storage = data.storage ?? {};
  const topStatus = data.status ?? storage.status ?? "unknown";
  const writeProbeOk = storage.writeProbeOk;
  const onPersistentMount = storage.onPersistentMount;

  const base = {
    onPersistentMount,
    writeProbeOk,
    persistBackend: storage.persistBackend,
    projectCount: storage.projectCount,
    storeExists: storage.storeExists,
    lastBoot: storage.lastBoot,
    message: storage.message ?? storage.storeReadError,
  };

  if (writeProbeOk === false) {
    return {
      ...base,
      status: "degraded",
      writeProbeOk: false,
      message: base.message ?? "Write probe failed",
    };
  }

  if (storage.persistBackend === "file") {
    return {
      ...base,
      status: "degraded",
      writeProbeOk: writeProbeOk ?? true,
      message:
        base.message ??
        "Workspace catalog uses ephemeral file storage — projects are lost when this server instance restarts.",
    };
  }

  if (storage.lastBoot === "empty-after-missing-file" || storage.storeExists === false) {
    return {
      ...base,
      status: "degraded",
      writeProbeOk: writeProbeOk ?? true,
      message:
        base.message ??
        "Workspace catalog is missing or was reset — saved projects may not be available.",
    };
  }

  if (topStatus === "healthy") {
    return {
      ...base,
      status: "healthy",
      writeProbeOk: writeProbeOk ?? true,
    };
  }

  if (topStatus === "degraded") {
    return {
      ...base,
      status: "degraded",
    };
  }

  return {
    ...base,
    status: "unknown",
  };
}

export function shouldShowStorageUnavailableBanner(
  storage: ClientStorageStatus | null
): boolean {
  if (!storage || storage.status === "loading") return false;
  return storageReliabilityIssue(storage) !== null;
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
