import { NextRequest } from "next/server";
import * as services from "@/lib/domain/services";
import {
  collectStorageDiagnostics,
  loadSharedStoreCatalog,
} from "@/lib/domain/storage-diagnostics";
import { apiError, runApiHandler } from "@/lib/api-route";

export async function GET() {
  return runApiHandler(async () => {
    const catalog = await loadSharedStoreCatalog();
    const storage = await collectStorageDiagnostics({ catalog });

    if (!catalog.storeExists && catalog.listableProjectCount === 0) {
      return {
        projects: [],
        recentAnalyses: [],
        recentActivity: [],
        storage,
      };
    }

    const dashboard = services.listHomeDashboardFromStore(catalog.store);
    return {
      ...dashboard,
      storage: { ...storage, projectCount: dashboard.projects.length },
    };
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return apiError("Invalid JSON body", 400);
  }

  return runApiHandler(() =>
    services.createProject({
      name: body.name as string,
      objectiveText: services.resolveCreateObjectiveText(body) as string,
      geographyLabel: body.geographyLabel as string | undefined,
      mode: body.mode as "explore" | "planning" | undefined,
      fromExplore: body.fromExplore === true,
    })
  );
}
