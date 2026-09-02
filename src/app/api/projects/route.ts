import { NextRequest, NextResponse } from "next/server";
import * as services from "@/lib/domain/services";

export async function GET() {
  const projects = await services.listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ws = await services.createProject({
      name: body.name,
      objectiveText: body.objectiveText,
      geographyLabel: body.geographyLabel,
      mode: body.mode,
    });
    return NextResponse.json(ws);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to create project";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
