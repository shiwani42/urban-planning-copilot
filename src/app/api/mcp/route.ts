import { NextRequest, NextResponse } from "next/server";
import { invokeTool, listTools } from "@/lib/domain/webmcp";

export async function GET() {
  return NextResponse.json({
    name: "Urban Planning Copilot WebMCP",
    version: "1.0.0",
    tools: listTools(),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const { tool, arguments: args, name } = body as {
    tool?: string;
    name?: string;
    arguments?: unknown;
  };
  const toolName = tool ?? name;
  if (!toolName) {
    return NextResponse.json({ ok: false, error: "Missing tool name" }, { status: 400 });
  }

  const result = await invokeTool(toolName, args ?? body.args ?? {});
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}
