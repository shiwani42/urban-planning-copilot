import { NextRequest } from "next/server";
import * as services from "@/lib/domain/services";
import { readStorageHealth } from "@/lib/domain/store";
import { apiError, runApiHandler } from "@/lib/api-route";

export async function GET() {
  return runApiHandler(async () => {
    const projects = await services.listProjects();
    return { projects, storage: readStorageHealth() };
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
      objectiveText: body.objectiveText as string,
      geographyLabel: body.geographyLabel as string | undefined,
      mode: body.mode as "explore" | "planning" | undefined,
    })
  );
}
