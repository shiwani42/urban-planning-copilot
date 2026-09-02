import { NextRequest, NextResponse } from "next/server";
import * as services from "@/lib/domain/services";

export async function GET() {
  const projects = await services.listProjects();
  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const ws = await services.createProject({
    name: body.name,
    objectiveText: body.objectiveText,
    geographyLabel: body.geographyLabel,
    mode: body.mode,
  });
  return NextResponse.json(ws);
}
