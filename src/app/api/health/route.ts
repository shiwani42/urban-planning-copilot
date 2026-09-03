import {
  collectStorageDiagnostics,
  loadSharedStoreCatalog,
} from "@/lib/domain/storage-diagnostics";
import { runApiHandler } from "@/lib/api-route";

export async function GET() {
  return runApiHandler(async () => {
    const catalog = await loadSharedStoreCatalog();
    const storage = await collectStorageDiagnostics({ catalog });
    return {
      status: storage.status,
      storage,
    };
  });
}
