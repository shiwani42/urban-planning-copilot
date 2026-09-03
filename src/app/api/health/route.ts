import { collectStorageDiagnostics } from "@/lib/domain/storage-diagnostics";
import { runApiHandler } from "@/lib/api-route";

export async function GET() {
  return runApiHandler(async () => {
    const storage = await collectStorageDiagnostics({ includeProjectCount: true });
    return {
      status: storage.status,
      storage,
    };
  });
}
