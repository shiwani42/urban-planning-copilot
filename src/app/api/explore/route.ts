import { NextRequest, NextResponse } from "next/server";
import * as services from "@/lib/domain/services";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const question = String(body.question ?? "").trim();
    if (!question) {
      return NextResponse.json({ error: "Question is required" }, { status: 400 });
    }
    const result = await services.exploreScratch(question);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Explore failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
