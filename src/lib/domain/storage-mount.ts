import { execFile } from "node:child_process";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const VAR_DATA = "/var/data";

let mountDetectorForTests: ((dir: string) => Promise<boolean>) | null = null;

export function setMountDetectorForTests(
  fn: ((dir: string) => Promise<boolean>) | null
): void {
  mountDetectorForTests = fn;
}

export function legacyRenderDataDir(): string {
  return process.env.LEGACY_DATA_DIR ?? "/opt/render/project/src/data";
}

/** Candidate dirs that may hold store.json / .bak on Render (current + target mounts). */
export function storeSearchDirs(resolvedDataDir: string): string[] {
  const dirs = [resolvedDataDir, legacyRenderDataDir(), VAR_DATA];
  return dirs.filter((dir, index, all) => all.indexOf(dir) === index);
}

async function isMountPointByStat(mountPath: string): Promise<boolean> {
  const resolved = path.resolve(mountPath);
  const parent = path.dirname(resolved);
  if (parent === resolved) return true;
  try {
    const [st, pst] = await Promise.all([fs.stat(resolved), fs.stat(parent)]);
    return st.dev !== pst.dev;
  } catch {
    return false;
  }
}

/** True when the path exists, is writable, and is a separate mount from its parent. */
export async function isRealMount(mountPath: string): Promise<boolean> {
  if (mountDetectorForTests) {
    return mountDetectorForTests(mountPath);
  }

  try {
    await fs.access(mountPath, constants.F_OK | constants.W_OK);
  } catch {
    return false;
  }

  try {
    const { stdout } = await execFileAsync(
      "findmnt",
      ["-no", "TARGET", "-T", mountPath],
      { timeout: 2000 }
    );
    const target = stdout.trim();
    if (target) {
      const resolved = path.resolve(mountPath);
      const targetResolved = path.resolve(target);
      return (
        resolved === targetResolved ||
        resolved.startsWith(`${targetResolved}${path.sep}`)
      );
    }
  } catch {
    /* findmnt unavailable or path not in mount table */
  }

  return isMountPointByStat(mountPath);
}

/**
 * Resolve the directory used for store.json.
 * Honors process.env.DATA_DIR when set to a non-/var/data path.
 * Uses /var/data only when it is a real, writable mount; otherwise falls back to
 * the legacy Render mount when that path is mounted.
 */
export async function resolveDataDir(): Promise<string> {
  const envDir = process.env.DATA_DIR ?? path.join(process.cwd(), "data");
  const legacyDir = legacyRenderDataDir();

  if (envDir !== VAR_DATA && !envDir.startsWith(`${VAR_DATA}/`)) {
    return envDir;
  }

  if (await isRealMount(envDir)) {
    return envDir;
  }

  if (legacyDir !== envDir && (await isRealMount(legacyDir))) {
    console.error(
      `[store] DATA_DIR=${envDir} is not a mounted volume — using ${legacyDir}`
    );
    return legacyDir;
  }

  return envDir;
}
