"use client";

import {
  shouldShowStorageUnavailableBanner,
  useStorageStatus,
} from "@/lib/storage-status";

export function StorageBanner() {
  const storage = useStorageStatus();

  if (!shouldShowStorageUnavailableBanner(storage)) return null;

  const message =
    storage.fetchError ??
    storage.message ??
    "Projects may not persist across restarts until storage is restored.";

  return (
    <div
      role="alert"
      className="bg-error-container/30 border-b border-error/40 px-section-padding py-2 text-body-sm text-on-surface shrink-0"
    >
      <strong>Workspace storage unavailable.</strong> {message}
      {storage.onPersistentMount === false && (
        <span className="block text-caption mt-0.5">
          Server data directory is not on the persistent disk mount — contact your administrator.
        </span>
      )}
      {storage.writeProbeOk === false && storage.onPersistentMount && (
        <span className="block text-caption mt-0.5">
          The persistent disk is mounted but writes failed — new projects may not save until this
          is resolved.
        </span>
      )}
    </div>
  );
}
