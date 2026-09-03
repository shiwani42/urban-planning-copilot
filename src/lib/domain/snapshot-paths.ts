import path from "path";

/** Git-tracked SF open-data snapshots — never the runtime DATA_DIR mount. */
export function getSnapshotsRoot(): string {
  return path.join(process.cwd(), "snapshots");
}

export function getSfSnapshotsDir(): string {
  return path.join(getSnapshotsRoot(), "sf");
}
