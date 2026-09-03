"use client";

import { useCallback, useEffect, useState } from "react";
import {
  EPHEMERAL_SAVE_MESSAGE,
  PROJECTS_LOAD_FAILED,
  SAVE_UNAVAILABLE_FALLBACK,
  toPlannerStorageMessage,
} from "@/lib/planner-copy";
import { fetchJsonWithServerWake } from "@/lib/server-wake";

export type PersistBackend = "postgres" | "file";

export type ClientStorageStatus = {
  status: "loading" | "healthy" | "degraded" | "unknown" | "error";
  onPersistentMount?: boolean;
  writeProbeOk?: boolean;
  persistBackend?: PersistBackend;
  postgresOk?: boolean;
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
    postgresOk?: boolean;
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
  if (storage.postgresOk === false) return false;
  if (storage.storeExists === false) return false;
  if (storage.lastBoot === "empty-after-missing-file") return false;
  return storage.status === "healthy";
}

export function storageReliabilityIssue(storage: ClientStorageStatus | null): string | null {
  if (!storage || storage.status === "loading") return null;
  if (storage.fetchError) {
    return toPlannerStorageMessage(storage.fetchError, SAVE_UNAVAILABLE_FALLBACK);
  }
  if (storage.status === "error") {
    return toPlannerStorageMessage(storage.message, SAVE_UNAVAILABLE_FALLBACK);
  }
  if (storage.writeProbeOk === false) {
    return toPlannerStorageMessage(storage.message, SAVE_UNAVAILABLE_FALLBACK);
  }
  if (storage.persistBackend === "postgres") {
    if (storage.postgresOk === false) {
      return toPlannerStorageMessage(storage.message, SAVE_UNAVAILABLE_FALLBACK);
    }
    return null;
  }
  if (storage.lastBoot === "empty-after-missing-file" || storage.storeExists === false) {
    return "Some saved projects may be missing. Reload your project list or recreate studies that no longer appear.";
  }
  if (storage.status === "degraded") {
    return toPlannerStorageMessage(storage.message, SAVE_UNAVAILABLE_FALLBACK);
  }
  return null;
}

function normalizeHealthPayload(data: HealthPayload): ClientStorageStatus {
  const storage = data.storage ?? {};
  const topStatus = data.status ?? storage.status ?? "unknown";
  const writeProbeOk = storage.writeProbeOk;
  const onPersistentMount = storage.onPersistentMount;
  const persistBackend = storage.persistBackend;
  const postgresOk = storage.postgresOk;

  const base = {
    onPersistentMount,
    writeProbeOk,
    persistBackend,
    postgresOk,
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
      status: topStatus === "healthy" ? "healthy" : "degraded",
      writeProbeOk: writeProbeOk ?? true,
      message: base.message,
    };
  }

  if (storage.lastBoot === "empty-after-missing-file" || storage.storeExists === false) {
    return {
      ...base,
      status: "degraded",
      writeProbeOk: writeProbeOk ?? true,
      message:
        base.message ??
        "Some saved projects may be missing. Reload your project list or recreate studies that no longer appear.",
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

/** File-backend notice — hidden when durable cloud saving is active. */
export function shouldShowEphemeralStorageBanner(
  storage: ClientStorageStatus | null
): boolean {
  if (!storage || storage.status === "loading") return false;
  if (storage.persistBackend === "postgres" && storage.postgresOk !== false) {
    return false;
  }
  if (storage.persistBackend === "file") {
    return storage.status === "healthy" || storage.status === "degraded" || storage.status === "unknown";
  }
  return false;
}

export const EPHEMERAL_STORAGE_BANNER_MESSAGE = EPHEMERAL_SAVE_MESSAGE;

export function useStorageStatus(): ClientStorageStatus & { refresh: () => void } {
  const [storage, setStorage] = useState<ClientStorageStatus>({ status: "loading" });

  const refresh = useCallback(() => {
    setStorage((prev) => ({ ...prev, status: prev.status === "loading" ? "loading" : prev.status }));
    fetchJsonWithServerWake<HealthPayload>("/api/health", { cache: "no-store" }, {
      label: "Health check",
      retries: 3,
    })
      .then((data) => {
        setStorage(normalizeHealthPayload(data));
      })
      .catch((err) => {
        setStorage({
          status: "error",
          fetchError: err instanceof Error ? err.message : String(err),
          message: SAVE_UNAVAILABLE_FALLBACK,
        });
      });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { ...storage, refresh };
}
