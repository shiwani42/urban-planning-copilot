"use client";

import {
  EPHEMERAL_SAVE_HEADING,
  SAVE_ADMIN_HINT,
  SAVE_UNAVAILABLE_FALLBACK,
  SAVE_UNAVAILABLE_HEADING,
  SAVE_WRITE_FAILED_HINT,
} from "@/lib/planner-copy";
import {
  EPHEMERAL_STORAGE_BANNER_MESSAGE,
  shouldShowEphemeralStorageBanner,
  shouldShowStorageUnavailableBanner,
  storageReliabilityIssue,
  useStorageStatus,
} from "@/lib/storage-status";

export function StorageBanner() {
  const storage = useStorageStatus();

  const showUnavailable = shouldShowStorageUnavailableBanner(storage);
  const showEphemeral = shouldShowEphemeralStorageBanner(storage);

  if (!showUnavailable && !showEphemeral) return null;

  if (showUnavailable) {
    const message =
      storageReliabilityIssue(storage) ??
      storage.fetchError ??
      storage.message ??
      SAVE_UNAVAILABLE_FALLBACK;

    return (
      <div
        role="alert"
        className="bg-error-container/30 border-b border-error/40 px-section-padding py-2 text-body-sm text-on-surface shrink-0"
      >
        <strong>{SAVE_UNAVAILABLE_HEADING}</strong> {message}
        {storage.onPersistentMount === false && (
          <span className="block text-caption mt-0.5">{SAVE_ADMIN_HINT}</span>
        )}
        {storage.writeProbeOk === false && storage.onPersistentMount && (
          <span className="block text-caption mt-0.5">{SAVE_WRITE_FAILED_HINT}</span>
        )}
      </div>
    );
  }

  return (
    <div
      role="status"
      className="bg-secondary-container/40 border-b border-secondary/30 px-section-padding py-2 text-body-sm text-on-surface shrink-0"
    >
      <strong>{EPHEMERAL_SAVE_HEADING}</strong> {EPHEMERAL_STORAGE_BANNER_MESSAGE}
    </div>
  );
}
