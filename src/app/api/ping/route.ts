import { NextResponse } from "next/server";

/** Lightweight liveness probe — does not load the planning store. */
export async function GET() {
  return NextResponse.json({ ok: true });
}
